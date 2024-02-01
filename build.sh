#!/bin/bash

check_prerequisites() {
	if ! command -v zip >/dev/null 2>&1; then
		echo "zip is not installed"
		exit 1
	fi
}

create_zip() {
	# $1: browser
	zip -r "$1.zip" manifest.json LICENSE PRIVACY-POLICY.md search_predict.css search_predict.js sw.js images/logo[0123456789]*.png
}

prepare_firefox() {
	mv manifest.json manifest-chromium.json
	mv manifest-ff.json manifest.json
}

cleanup_firefox() {
	mv manifest.json manifest-ff.json
	mv manifest-chromium.json manifest.json
}


check_prerequisites

create_zip chromium
prepare_firefox
create_zip firefox
cleanup_firefox
