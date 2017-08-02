/*
    ***** BEGIN LICENSE BLOCK *****
    
    Copyright © 2011 Center for History and New Media
                     George Mason University, Fairfax, Virginia, USA
                     http://zotero.org
    
    This file is part of Zotero.
    
    Zotero is free software: you can redistribute it and/or modify
    it under the terms of the GNU Affero General Public License as published by
    the Free Software Foundation, either version 3 of the License, or
    (at your option) any later version.
    
    Zotero is distributed in the hope that it will be useful,
    but WITHOUT ANY WARRANTY; without even the implied warranty of
    MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
    GNU Affero General Public License for more details.
    
    You should have received a copy of the GNU Affero General Public License
    along with Zotero.  If not, see <http://www.gnu.org/licenses/>.
    
    ***** END LICENSE BLOCK *****
*/

// TODO: refactor this class
Zotero.Connector = {
	_CONNECTOR_API_VERSION: 2,
	
	// As of Chrome 38 (and corresponding Opera version 24?) pages loaded over
	// https (i.e. the zotero bookmarklet iframe) can not send requests over
	// http, so pinging Standalone at http://127.0.0.1 fails.
	// Disable for all browsers, except IE, which may be used frequently with ZSA
	isOnline: Zotero.isBookmarklet && !Zotero.isIE ? false : null,
	_shouldReportActiveURL: true,
	_selected: {collection: null, library: null, item: null},
	
	init: function() {
		this.addEventListener('init', {notify: function(data) {
			this._selected = data.selected;
		}.bind(this)});
		this.addEventListener('select', {notify: function(data) {
			Object.assign(this._selected, data);
		}.bind(this)});
		Zotero.Connector.SSE.init();
	},
	
	/**
	 * Checks if Zotero is online and passes current status to callback
	 * @param {Function} callback
	 */
	checkIsOnline: Zotero.Promise.method(function() {
		// Only check once in bookmarklet
		if(Zotero.isBookmarklet && this.isOnline !== null) {
			return this.isOnline;
		}
		// If SSE is available then we can return current status too
		if (Zotero.Connector.SSE.available) {
			return this.isOnline;
		}

		return Zotero.Connector.ping("ping", {});
	}),

	reportActiveURL: function(url) {
		if (!this.isOnline || !this._shouldReportActiveURL) return;
		
		let payload = { activeURL: url };
		this.ping(payload);
	},
	
	ping: function(payload={}) {
		return Zotero.Connector.callMethod("ping", payload).then(function(response) {
			if (response && 'prefs' in response) {
				Zotero.Connector._shouldReportActiveURL = !!response.prefs.reportActiveURL;
				Zotero.Connector.automaticSnapshots = !!response.prefs.automaticSnapshots;
			}
			
			return response;
		});
	},
	
	getSelectedCollection: Zotero.Promise.method(function() {
		if (!Zotero.Connector.isOnline) {
			throw new this.CommunicationError('Zotero is Offline');
		} else if (Zotero.Connector.SSE.available) {
			return this._selected;
		} else {
			return this.callMethod('getSelectedCollection', {}).then(function(response) {
				let selected = {library: {editable: response.libraryEditable}};
				selected.library.id = response.id;
				selected.collection = {name: response.name};
				return selected;
			});
		}
	}),
	
	/**
	 * Sends the XHR to execute an RPC call.
	 *
	 * @param {String|Object} options - The method name as a string or an object with the
	 *     following properties:
	 *         method - method name
	 *         headers - an object of HTTP headers to send
	 *         queryString - a query string to pass on the HTTP call
	 * @param {Object} data - RPC data to POST. If null or undefined, a GET request is sent.
	 * @param {Function} callback - Function to be called when requests complete.
	 */
	callMethod: Zotero.Promise.method(function(options, data, cb, tab) {
		// TODO: make this default behaviour once people switch to SSE enabled Zotero
		// and add communication if Zotero.isOnline but SSE unavailable - i.e. fairly old version
		// Don't bother trying if not online in bookmarklet
		if (Zotero.isBookmarklet && this.isOnline === false) {
			throw new Zotero.CommunicationError("Zotero Offline", 0);
		}
		if (typeof options == 'string') {
			options = {method: options};
		}
		var method = options.method;
		var headers = Object.assign({
				"Content-Type":"application/json",
				"X-Zotero-Version":Zotero.version,
				"X-Zotero-Connector-API-Version":Zotero.Connector._CONNECTOR_API_VERSION
			}, options.headers || {});
		var queryString = options.queryString ? ("?" + options.queryString) : "";
		
		var deferred = Zotero.Promise.defer();
		var newCallback = function(req) {
			try {
				var isOnline = req.status !== 0 && req.status !== 403 && req.status !== 412;
				if(Zotero.Connector.isOnline !== isOnline) {
					Zotero.Connector.isOnline = isOnline;
					if (Zotero.Connector_Browser && Zotero.Connector_Browser.onStateChange) {
						Zotero.Connector_Browser.onStateChange(isOnline && req.getResponseHeader('X-Zotero-Version'));
					}
				}
				var val = null;
				if(req.responseText) {
					if(req.getResponseHeader("Content-Type") === "application/json") {
						val = JSON.parse(req.responseText);
					} else {
						val = req.responseText;
					}
				}
				if(req.status == 0 || req.status >= 400) {
					Zotero.debug("Connector: Method "+method+" failed with status "+req.status);
					deferred.reject(new Zotero.Connector.CommunicationError(`Method ${options.method} failed`, req.status, val));
					
					// Check for incompatible version
					if(req.status === 412) {
						if(Zotero.Connector_Browser && Zotero.Connector_Browser.onIncompatibleStandaloneVersion) {
							var standaloneVersion = req.getResponseHeader("X-Zotero-Version");
							Zotero.Connector_Browser.onIncompatibleStandaloneVersion(Zotero.version, standaloneVersion);
							deferred.reject("Connector: Version mismatch: Connector version "+Zotero.version
								+", Standalone version "+(standaloneVersion ? standaloneVersion : "<unknown>", val));
						}
					}
				} else {
					Zotero.debug("Connector: Method "+method+" succeeded");
					deferred.resolve(val);
				}
			} catch(e) {
				Zotero.logError(e);
				deferred.reject(new Zotero.Connector.CommunicationError(e.message, 0));
			}
		};
		
		if(Zotero.isIE) {	// IE requires XDR for CORS
			if(_ieStandaloneIframeTarget) {
				var requestID = Zotero.Utilities.randomString();
				_ieConnectorCallbacks[requestID] = newCallback;
				_ieStandaloneIframeTarget.postMessage(JSON.stringify([null, "connectorRequest",
					[requestID, method, JSON.stringify(data)]]), `${Zotero.Prefs.get('connector.url')}/connector/ieHack`);
			} else {
				Zotero.debug("Connector: No iframe target; not sending to Standalone");
				throw new Zotero.Connector.CommunicationError("No iframe target; not sending to Standalone", 0);
			}
		} else {							// Other browsers can use plain doPost
			var uri = Zotero.Prefs.get('connector.url') + "connector/" + method + queryString;
			if (headers["Content-Type"] == 'application/json') {
				data = JSON.stringify(data);
			}
			let options = {body: data, headers, successCodes: false};
			let httpMethod = data == null || data == undefined ? "GET" : "POST";
			Zotero.HTTP.request(httpMethod, uri, options).then(newCallback);
		}
		return deferred.promise;
	}),
	
	/**
	 * Adds detailed cookies to the data before sending "saveItems" request to
	 *  the server/Standalone
	 *
	 * @param {String|Object} options. See documentation above
	 * @param	{Object} data RPC data. See documentation above.
	 */
	callMethodWithCookies: function(options, data, cb, tab) {
		if (Zotero.isBrowserExt && !Zotero.isBookmarklet) {
			return new Zotero.Promise(function(resolve) {
				chrome.cookies.getAll({url: tab.url}, resolve);
			}).then(function(cookies) {
				var cookieHeader = '';
				for(var i=0, n=cookies.length; i<n; i++) {
					cookieHeader += '\n' + cookies[i].name + '=' + cookies[i].value
						+ ';Domain=' + cookies[i].domain
						+ (cookies[i].path ? ';Path=' + cookies[i].path : '')
						+ (cookies[i].hostOnly ? ';hostOnly' : '') //not a legit flag, but we have to use it internally
						+ (cookies[i].secure ? ';secure' : '');
				}
				
				if(cookieHeader) {
					data.detailedCookies = cookieHeader.substr(1);
					delete data.cookie;
				}
				
				// Cookie URI needed to set up the cookie sandbox on standalone
				data.uri = tab.url;
				
				return this.callMethod(options, data, cb, tab);
			}.bind(this));
		}
		
		return this.callMethod(options, data, cb, tab);
	}
}

Zotero.Connector.CommunicationError = function (message, status=0, value='') {
    this.name = 'Connector Communication Error';
    this.message = message;
    this.status = status;
    this.value = value;
}
Zotero.Connector.CommunicationError.prototype = new Error;


Zotero.Connector.SSE = {
	_listeners: {},
	available: false,

	init: function() {
		this._evtSrc = new EventSource(ZOTERO_CONFIG.CONNECTOR_SERVER_URL + 'connector/sse');
		this._evtSrc.onerror = this._onError.bind(this);
		this._evtSrc.onmessage = this._onMessage.bind(this);
		this._evtSrc.onopen = this._onOpen.bind(this);
	},
	
	_onError: function(e) {
		this._evtSrc.close();
		delete this._evtSrc;
		
		if (Zotero.Connector.isOnline) {
			Zotero.Connector.isOnline = false;
			Zotero.Connector_Browser.onStateChange(false);
			Zotero.debug('Zotero client went offline');
		}

		if (e.target.readyState != 1) {
			// Attempt to reconnect every 10 secs
			return setTimeout(this.init.bind(this), 10000);
		}
		// Immediately attempt to reconnect in case of a simple HTTP timeout
		this.init();
	},
	
	_onMessage: function(e) {
		var data = JSON.parse(e.data);
		Zotero.debug(`SSE event '${data.event}':${JSON.stringify(data.data).substr(0, 100)}`);
		if (data.event in this._listeners) {
			this._listeners[data.event].forEach((l) => l.notify(data.data));
		}
	},
	
	_onOpen: function() {
		this.available = true;
		Zotero.Connector.ping();
		Zotero.debug('Zotero client is online');
	},
	
	_addEventListener: function(event, fn) {
		if (event in this._listeners) {
			this._listeners[event].push(fn);
		} else {
			this._listeners[event] = [fn];
		}
		return fn;
	},
	
	_removeEventListener: function(event, fn) {
		if (event in this._listeners) {
			this._listeners[event] = this._listeners[event].filter((l) => l !== listener);
		}
	}
};
Zotero.Connector.addEventListener = Zotero.Connector.SSE._addEventListener.bind(Zotero.Connector.SSE);
Zotero.Connector.removeEventListener = Zotero.Connector.SSE._removeEventListener.bind(Zotero.Connector.SSE);


// TODO: this does not belong here in the slightest
Zotero.Connector_Debug = new function() {
	/**
	 * Call a callback depending upon whether debug output is being stored
	 */
	this.storing = function() {
		return Zotero.Debug.storing;
	}
	
	/**
	 * Call a callback with the lines themselves
	 */
	this.get = function() {
		return Zotero.Debug.get();
	};
		
	/**
	 * Call a callback with the number of lines of output
	 */
	this.count = function() {
		return Zotero.Debug.count();
	}
	
	/**
	 * Submit data to the server
	 */
	this.submitReport = function() {
		return Zotero.Debug.get().then(function(body){
			return Zotero.HTTP.request("POST", ZOTERO_CONFIG.REPOSITORY_URL + "report?debug=1", {body});
		}).then(function(xmlhttp) {
			if (!xmlhttp.responseXML) {
				throw new Error('Invalid response from server');
			}
			var reported = xmlhttp.responseXML.getElementsByTagName('reported');
			if (reported.length != 1) {
				throw new Error('The server returned an error. Please try again.');
			}
			return reported[0].getAttribute('reportID');
		});
	};
}
