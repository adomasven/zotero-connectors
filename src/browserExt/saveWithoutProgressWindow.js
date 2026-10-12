/*
	***** BEGIN LICENSE BLOCK *****
	
	Copyright © 2018 Center for History and New Media
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

// We cannot display a progress window in Firefox PDFs and if CSP sets a sandbox
// We detect it and initiate a save directly from the background page
// and changes the action button into a "tick.png" icon after the save is complete
Zotero.WebRequestIntercept.addListener('headersReceived', function(details) {
	// Proxy login is a POST method that gets redirected to the final destination via a 302
	if (details.method != "GET" && details.statusCode < 300 && details.statusCode >= 400) return;
	
	let isPDF = false;
	let isCSPProtected = false;
	const contentType = details.responseHeadersObject['content-type']?.split(';')[0]?.trim();

	// Firefox currently does not allow to inject scripts into pdf pages
	// See https://bugzilla.mozilla.org/show_bug.cgi?id=1454760#c3
	if (Zotero.isFirefox) {
		if (contentType) {
			if (contentType.includes("application/pdf")) {
				isPDF = true;
			}
			// While Firefox will show the PDF viewer for application/octet-stream, it must pass some
			// additional checks: the URL must end in .pdf and the PDF must be a top-level document.
			// https://searchfox.org/mozilla-central/rev/50c3cf7a3c931409b54efa009795b69c19383541/toolkit/components/pdfjs/content/PdfStreamConverter.jsm#1100-1121
			else if (contentType.includes("application/octet-stream")
					&& details.url.includes(".pdf") && details.type === "main_frame") {
				isPDF = true;
			}
		}
	}
	
	if (!isPDF) {
		// Address pages like github gists where we are prevented from injecting the progress window due to
		// the restrictive CSP.
		const csp = details.responseHeadersObject['content-security-policy'];
		isCSPProtected = csp && csp.includes("sandbox") && !csp.includes("allow-scripts");
	}
	
	if (!isPDF && !isCSPProtected) return;
	
	// Somehow browser.webNavigation.onCommitted runs later than headersReceived
	setTimeout(async function() {
		var tab = await browser.tabs.get(details.tabId);
		let tabInfo = Zotero.Connector_Browser.getTabInfo(tab.id);
		tabInfo.uninjectable = true;
		tabInfo.isPDF = isPDF;
		tabInfo.contentType = contentType;
		Zotero.Connector_Browser._updateExtensionUI(tab);
	}, 100);
});

/**
 * @param {Tab} tab
 * @param {Integer} [frameId]
 * @param {Object} [session] - Progress window popup session (see Zotero.ProgressWindowPopup)
 * 	that is updated with the save progress
 */
Zotero.Utilities.saveWithoutProgressWindow = async function (tab, frameId, session) {
	let url = tab.url;
	let tabInfo = Zotero.Connector_Browser.getTabInfo(tab.id);
	const pdf = tabInfo.isPDF;
	// Get URL from iframe
	if (frameId) {
		({ url } = await browser.webNavigation.getFrame({ tabId: tab.id, frameId }));
	}
	
	var data = {
		url,
		pdf,
		mimeType: tabInfo.contentType,
		sessionID: session?.sessionID || Zotero.Utilities.randomString()
	};
	if (pdf) {
		data.title = tab.title || new URL(url).pathname.split('/').pop();
	}
	else {
		data.title = url;
	}
	
	// The attachment row in the progress window
	let progressItem = {
		id: 1,
		iconSrc: Zotero.ItemTypes.getImageSrc(pdf ? 'attachment-pdf' : 'attachment-webpage'),
		title: data.title,
		progress: 0,
		itemType: Zotero.getString(`itemType_${pdf ? 'pdf' : 'webpage'}`)
	};
	if (session) {
		session.items = [progressItem];
	}
	
	try {
		browser.browserAction.setIcon({
			tabId:tab.id,
			path: {
				'16': 'images/spinner-16px.png',
				'32': 'images/spinner-16px@2x.png'
			}
		});
		browser.browserAction.setTitle({
			tabId:tab.id,
			title: Zotero.getString('browserAction_saving')
		});
		
		try {
			// Check availability before fetching the attachment
			await Zotero.Connector.ping();
			let result = await Zotero.ItemSaver.saveStandaloneAttachmentToZotero(data, data.sessionID, tab);
			if (session && result?.canRecognize) {
				try {
					let item = await Zotero.Connector.callMethod("getRecognizedItem", { sessionID: data.sessionID });
					if (item) {
						session.items = [
							{ ...item, id: 2, iconSrc: Zotero.ItemTypes.getImageSrc(item.itemType), progress: 100 },
							progressItem
						];
						progressItem.parentItem = 2;
					}
				}
				catch (e) {
					Zotero.logError(e);
				}
			}
		}
		catch (e) {
			if (e.status !== 0 || !pdf) throw e;
			data.linkMode = 'imported_url';
			if (session) {
				session.savedToServer = true;
			}
			await Zotero.ItemSaver.saveAttachmentToServer(data, tab);
		}
		progressItem.progress = 100;
		
		browser.browserAction.setIcon({
			tabId:tab.id,
			path: {
				'16': 'images/tick.png',
				'32': 'images/tick@2x.png'
			}
		});
		browser.browserAction.setTitle({
			tabId:tab.id,
			title: Zotero.getString('browserAction_saved')
		});
		tabInfo.isPDF = false;
	
	} catch (e) {
		if (e.status !== 0) {
			Zotero.logError(e);
		}
		progressItem.progress = false;
		if (session) {
			session.error = e.status === 0 ? 'clientRequired' : 'unexpectedError';
		}
		
		browser.browserAction.setIcon({
			tabId:tab.id,
			path: "images/cross.png"
		});
		
		browser.browserAction.setTitle({
			tabId:tab.id,
			title: Zotero.getString('browserAction_saveFailed', ZOTERO_CONFIG.CLIENT_NAME)
		});
	}
	finally {
		if (session) {
			session.done = true;
		}
	}
};

/**
 * Firefox does not allow injecting scripts into PDF pages, so we cannot show the in-page
 * progress window there. Instead, the progress window is shown in the extension button popup,
 * which is set for such tabs in Zotero.Connector_Browser._updateExtensionUI(). The popup
 * (progressWindow/progressWindowPopup.js) uses these methods to save the page and
 * update the save session.
 */
Zotero.ProgressWindowPopup = new function () {
	// tabId -> session
	const sessions = new Map();
	
	this.isEnabledForTab = function (tab) {
		if (!Zotero.isFirefox || typeof browser.browserAction?.setPopup != 'function') return false;
		return !!Zotero.Connector_Browser.getTabInfo(tab.id).uninjectable;
	};
	
	this.getPopupURL = function (tabId) {
		return browser.runtime.getURL(`progressWindow/progressWindow.html?tabId=${tabId}`);
	};
	
	function serialize(session) {
		let { sessionID, items, done, error, savedToServer, userUpdate } = session;
		return { sessionID, items, done, error, savedToServer, userUpdate };
	}
	
	/**
	 * Returns the save session for the tab, starting a save if the page hasn't been saved yet
	 * (or the last save failed)
	 */
	this.getSession = async function (tabId) {
		let tab = await browser.tabs.get(tabId);
		let session = sessions.get(tabId);
		if (!session || session.error) {
			session = {
				sessionID: Zotero.Utilities.randomString(),
				items: [],
				done: false,
				error: null,
				savedToServer: false,
				userUpdate: null
			};
			sessions.set(tabId, session);
			session.promise = Zotero.Utilities.saveWithoutProgressWindow(tab, 0, session);
		}
		return serialize(session);
	};
	
	/**
	 * Resolves with the session once the save is complete
	 */
	this.waitForSave = async function (tabId) {
		let session = sessions.get(tabId);
		if (!session) throw new Error(`No progress window popup session for tab ${tabId}`);
		await session.promise;
		return serialize(session);
	};
	
	/**
	 * Updates the target, tags and note of the saved item from the progress window
	 */
	this.updateSession = async function (tabId, data) {
		let session = sessions.get(tabId);
		if (!session) return;
		session.userUpdate = data;
		// The session doesn't exist in the client until the save request is made
		await session.promise;
		// Superseded by a later update
		if (session.userUpdate !== data) return;
		if (session.error || session.savedToServer) return;
		await Zotero.Connector.callMethod("updateSession", {
			sessionID: session.sessionID,
			target: data.target.id,
			tags: data.tags,
			note: data.note.replace(/\n/g, "<br>")
		});
	};
	
	// Called when the tab navigates or is closed
	this.clearSession = function (tabId) {
		sessions.delete(tabId);
	};
};
