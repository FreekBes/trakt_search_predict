console.log("[Search Predict for Trakt.tv] Starting up...");

// For communication between search_predict.js and sw.js.
const spPort = chrome.runtime.connect({ name: "searcher" });
spPort.onMessage.addListener(function(msg) {
	switch (msg["action"]) {
		case "pong":
			console.log("[Search Predict for Trakt.tv] pong");
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

const searchPredict = {
	predicting: false,

	// Abort currently running prediction in sw.js.
	cancelPredict: function() {
		spPort.postMessage({action: "abort"});
	},

	// Get the current value of the search query input, trim it and start the prediction.
	// If q seems empty, unlist all current predictions.
	initPredict: function() {
		if (searchPredict.predicting) {
			searchPredict.cancelPredict();
		}
		let q = document.getElementById("header-search-query").value;
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

	// Start the prediction process.
	// Includes extra protection against empty query values.
	// The prediction type is retrieved from the header-search form action on Trakt.tv.
	doPredict: function(q) {
		if (q == null || q == "") {
			searchPredict.unlistPredictions();
			return;
		}
		searchPredict.predicting = true;
		let searchType = document.getElementById("header-search").getAttribute("action");
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
		// Search prediction actually happens in sw.js, results are shared over spPort.
		spPort.postMessage({ action: "search", query: q, type: searchType });
	},

	// List prediction results. this function is a bit messy due to HTML work going on.
	// Start by unlisting the current ones, then check if there's actually still a value in the query field.
	// If there is, we create a HTML A element for every prediction, listed in a UL tag, which is added to
	// the prediction box. If there is a TMDB id included in the suggestion results, add that to the element.
	// This will be of use later, when retrieving the poster or image for each of the results.
	// The A tag will feature a href attribute, linking to the page of the show or movie that's been predicted.
	// At the end of the function, we fetch the "next" (so actually the first) poster listed by calling fetchNextPoster().
	listPredictions: function(predictions) {
		console.log("[Search Predict for Trakt.tv] Predictions:", predictions);
		searchPredict.unlistPredictions();
		const supportedTypes = ["movie", "show"];
		const predictionBox = document.getElementById("header-search-predictions");
		if (predictions.length > 0 && document.getElementById("header-search-query").value.trim() != "") {
			for (let i = 0; i < predictions.length; i++) {
				if (!supportedTypes.includes(predictions[i]["type"])) {
					continue;
				}

				// Clickable item
				const pItem = document.createElement("a");
				pItem.setAttribute("class", "header-search-prediction-item");
				pItem.setAttribute("target", "_self");
				pItem.setAttribute("title", predictions[i][predictions[i]["type"]]["title"] + (predictions[i][predictions[i]["type"]]["year"] != null ? " (" + predictions[i][predictions[i]["type"]]["year"] + ")" : ""));
				pItem.setAttribute("onclick", "event.preventDefault(); redirect(this.href); return false;");

				const predictionType = predictions[i]["type"];

				// Append poster
				const pItemPoster = document.createElement("img");
				pItemPoster.setAttribute("class", "header-search-prediction-item-poster");
				pItemPoster.setAttribute("src", "https://trakt.tv/assets/placeholders/thumb/poster-78214cfcef8495a39d297ce96ddecea1.png");
				pItemPoster.setAttribute("data-type", predictionType);
				pItemPoster.setAttribute("data-traktid", predictions[i][predictionType]["ids"]["trakt"]);
				if (predictions[i][predictionType]["ids"]["tmdb"] != null) {
					pItemPoster.setAttribute("data-postersrc", "tmdb");
					pItemPoster.setAttribute("data-id", predictions[i][predictionType]["ids"]["tmdb"]);
				}
				pItem.appendChild(pItemPoster);

				// Append text
				const pItemText = document.createElement("div");
				pItemText.setAttribute("class", "header-search-prediction-item-text");
				const pItemTextType = document.createElement("span");
				pItemTextType.setAttribute("class", "header-search-prediction-item-type");
				pItemTextType.innerText = predictionType.charAt(0).toUpperCase() + predictionType.slice(1);
				pItemText.appendChild(pItemTextType);
				const pItemTextTitle = document.createElement("span");
				pItemTextTitle.innerText = predictions[i][predictionType]["title"];
				if (predictions[i][predictionType]["year"] != null) {
					const pItemTextYear = document.createElement("small");
					pItemTextYear.innerText = " (" + predictions[i][predictionType]["year"] + ")";
					pItemTextTitle.appendChild(pItemTextYear);
				}
				pItemText.appendChild(pItemTextTitle);
				pItem.appendChild(pItemText);

				// Link to item
				pItem.setAttribute("href", "/"+predictionType+"s/"+predictions[i][predictionType]["ids"]["slug"]);

				predictionBox.appendChild(pItem);
				predictionBox.appendChild(pItem);
			}

			searchPredict.lastPosterFetched = 0;
			searchPredict.postersToFetch = predictions.length;
			searchPredict.fetchNextPoster();
		}
	},

	// Below function (and variables) handle the poster or image fetching for shows and movies.
	// These images are not given by Trakt.tv's API, so we fetch them from other sources instead.
	// Currently, they're only fetched from TMDB (TheMovieDataBase). But first, we check the cache.
	// All previously fetched images are stored in the local storage of the extension under a certain
	// cacheId, which is made up by the movie or show's Trakt ID. If no image was found in cache,
	// we start fetching them from the sources using their APIs instead.
	// In case no image has been found after all, we use a placeholder image and start with the next
	// prediction's image, for which this same function is called once more.
	// As soon as postersToFetch == 0, the function stops running.
	postersToFetch: 0,
	lastPosterFetched: 0,
	fetchNextPoster: function() {
		if (searchPredict.lastPosterFetched < searchPredict.postersToFetch) {
			// console.log("[Search Predict for Trakt.tv] Fetching poster " + (searchPredict.lastPosterFetched+1) + " / " + searchPredict.postersToFetch);
			const posters = document.getElementsByClassName("header-search-prediction-item-poster");
			const i = searchPredict.lastPosterFetched;
			searchPredict.lastPosterFetched += 1;
			if (posters[i] != undefined) {
				const cacheId = 'poster_'+posters[i].getAttribute("data-traktid");
				chrome.storage.local.get(cacheId, function(data) {
					if (typeof data[cacheId] === 'undefined') {
						if (posters[i].hasAttribute("data-postersrc")) {
							// console.log("[Search Predict for Trakt.tv] Contacting API...");
							switch (posters[i].getAttribute("data-postersrc")) {
								case "tmdb":
									let fetchUrl = 'https://api.themoviedb.org/3/';
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
									const imgFetcher = new XMLHttpRequest();
									imgFetcher.open('GET', fetchUrl);
									imgFetcher.poster = posters[i];
									imgFetcher.setRequestHeader('Content-type', 'application/json');
									imgFetcher.onload = function() {
										try {
											const imgRes = JSON.parse(imgFetcher.responseText);
											if (imgRes["posters"] != null && imgRes["posters"].length > 0 && this.poster != undefined) {
												const posterUrl = "https://image.tmdb.org/t/p/w92" + imgRes["posters"][0]["file_path"];
												this.poster.src = posterUrl;
												const cacheId = 'poster_'+this.poster.getAttribute("data-traktid");
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

	// Remove all previous predictions from the prediction list.
	unlistPredictions: function() {
		const predictionsList = document.getElementById("header-search-predictions");
		while (predictionsList && predictionsList.firstChild) {
			predictionsList.removeChild(predictionsList.firstChild);
		}
	},

	// Resize the search prediction box based on the width of elements above it.
	// Very useful for when the window gets resized!
	resizeSearchPredictBox: function(timeoutms) {
		if (timeoutms == null) {
			timeoutms = 500;
		}
		setTimeout(function() {
			let searchPredictWidth = 0;
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

	// Capture keydown events for traversing the prediction list. only certain keys get caught (see switch statement).
	// We look at which element is currently focused in the browser. If that was one of "ours", we get the index of that
	// Element based on its parent, and based on which key has been pressed, we focus on the previous or next prediction listed.
	// By using JS's focus function, we don't have to worry about actually selecting the prediction, since it's an A element that
	// has focus, which is usually already handled well by the browser (by pressing enter, for example).
	keyboardControls: function(e) {
		if (e.target.id == "header-search-query" || (e.target.type != 'text' && e.target.nodeName != 'TEXTAREA' && e.target.getAttribute("contenteditable") == null)) {
			const headerSearchPredictions = document.getElementById("header-search-predictions");
			if (!headerSearchPredictions) {
				return false;
			}
			const key = e.keyCode || e.which;
			const predictAmount = headerSearchPredictions.children.length;
			let predictActiveIndex = -1;
			if (document.activeElement.className.indexOf("header-search-prediction-item") > -1) {
				predictActiveIndex = Array.prototype.indexOf.call(document.activeElement.parentNode.children, document.activeElement);
			}
			const prevPredictIndex = (predictActiveIndex <= 0 ? predictAmount - 1 : predictActiveIndex - 1);
			const nextPredictIndex = (predictActiveIndex == predictAmount - 1 ? 0 : predictActiveIndex + 1);
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

// Add the necessary event handlers and elements to the current page for use with the search predict functions.
// This means disabling the regular autocomplete for and adding an input listener to the search query field.
// We also add click listeners to the dropdown list of all searchable types (movies, shows, episodes, etc).
// When the search button gets clicked, we need to resize the suggestions box, since sometimes the search
// button expands or resizes the whole form.
// Could have used some CSS for the resizing, but that doesn't allow for proper text-overflow.
// We capture the keydown event for the whole page for keyboard controls. see the comment above the
// searchPredict.keyboardControls function for an explanation on how this works.
// We also capture mouseclicks to remove the list of predictions if clicked outside of the list container.
// In case there's no search query field found on the page, we don't actually do anything.
// There's no search query to predict in this case.
function addSearchPredict() {
	const headerSearchQuery = document.getElementById("header-search-query");
	if (headerSearchQuery != null) {
		headerSearchQuery.setAttribute("autocomplete", "off");
		headerSearchQuery.addEventListener("input", searchPredict.initPredict);

		const searchTypeDropdown = document.getElementById("header-search-type").children[1];
		for (let stdi = 0; stdi < searchTypeDropdown.children.length; stdi++) {
			searchTypeDropdown.children[stdi].addEventListener("click", function() {
				searchPredict.resizeSearchPredictBox(10);
				searchPredict.initPredict();
			});
		}
		document.getElementById("header-search-button").addEventListener("click", function() {
			searchPredict.resizeSearchPredictBox(1000);
		});

		const predictionBox = document.createElement('div');
		predictionBox.setAttribute("id", "header-search-predictions");
		document.getElementById("header-search").appendChild(predictionBox);

		window.addEventListener("resize", searchPredict.resizeSearchPredictBox);
		searchPredict.resizeSearchPredictBox();

		window.addEventListener("keydown", searchPredict.keyboardControls);
		window.addEventListener("click", function(event) {
			let elem = event.target;
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

		console.log("[Search Predict for Trakt.tv] Search Predict extension loaded successfully");
	}
	else {
		console.warn("[Search Predict for Trakt.tv] Could not load Search Predict, as no search box has been found on this page.");
	}

	document.addEventListener("turbolinks:load", function() {
		// Add the search predict functions every time turbolinks loads a new page
		addSearchPredict();
	});
}

addSearchPredict();
