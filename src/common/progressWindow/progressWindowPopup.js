/*
    ***** BEGIN LICENSE BLOCK *****
    
    Copyright © 2026 Corporation for Digital Scholarship
                     Vienna, Virginia, USA
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

/**
 * Drives the progress window when it's displayed in the extension button popup on pages where
 * the in-page progress window can't be injected (Firefox PDFs), taking the role of
 * progressWindow_inject.js. The save itself runs in the background page
 * (Zotero.ProgressWindowPopup in saveWithoutProgressWindow.js), so that it continues if the popup
 * is closed, and reopening the popup shows the same save.
 */
Zotero.ProgressWindowPopupView = new function () {
	var tabId;
	var closeTimeoutID;
	var closeOnLeave = false;
	var hovering = false;
	var closeTimerDisabled = false;
	
	this.init = async function (popupTabId) {
		tabId = popupTabId;
		Zotero.isProgressWindowPopup = true;
		document.documentElement.classList.add('is-popup');
		
		// The ProgressWindow component sends its messages to progressWindow_inject.js in the page.
		// Handle them here instead.
		Zotero.Messaging.sendMessage = async function (name, data) {
			let handler = handlers[name.replace(/^progressWindowIframe\./, '')];
			return handler && handler(data);
		};
		
		let session = await Zotero.ProgressWindowPopup.getSession(tabId);
		let wasDone = session.done;
		await showSession(session, true);
		if (!wasDone) {
			session = await Zotero.ProgressWindowPopup.waitForSave(tabId);
			await showSession(session, false);
		}
		
		if (session.error) {
			sendToProgressWindow('addError', [session.error]);
		}
		else {
			sendToProgressWindow('willHide');
		}
		// Close automatically if the save finished while the popup was open, and when the mouse
		// leaves it after that, like the in-page progress window. When reopening a finished save,
		// only close when the mouse leaves.
		if (!wasDone) {
			startCloseTimer(session.error ? 8000 : 3000);
		}
		closeOnLeave = 2500;
	};
	
	const handlers = {
		updated(data) {
			stopCloseTimer();
			return Zotero.ProgressWindowPopup.updateSession(tabId, data);
		},
		close() {
			window.close();
		},
		mouseenter() {
			hovering = true;
			stopCloseTimer();
		},
		mouseleave() {
			hovering = false;
			if (closeOnLeave) {
				startCloseTimer(closeOnLeave);
			}
		},
		disableCloseTimer() {
			closeTimerDisabled = true;
			stopCloseTimer();
		},
		enableCloseTimer() {
			closeTimerDisabled = false;
		}
	};
	
	function sendToProgressWindow(name, data) {
		return Zotero.Messaging.receiveMessage([`progressWindowIframe.${name}`, data]);
	}
	
	async function showSession(session, updateHeadline) {
		for (let item of session.items) {
			sendToProgressWindow('updateProgress', [item.id, item]);
		}
		if (updateHeadline || session.savedToServer) {
			await updateHeadlineFromClient(session);
		}
	}
	
	/**
	 * Get the selected collection and collections list from the client and show them
	 * in the headline. Simplified version of updateFromClient() in progressWindow_inject.js.
	 */
	async function updateHeadlineFromClient(session) {
		let response;
		if (!session.savedToServer) {
			try {
				response = await Zotero.Connector.callMethod("getSelectedCollection", { switchToReadableLibrary: true });
			}
			catch (e) {}
		}
		if (!response) {
			sendToProgressWindow('changeHeadline', [Zotero.getString('progressWindow_savingToOnlineLibrary')]);
			return;
		}
		
		let target = {
			id: response.id,
			name: response.name,
			filesEditable: response.filesEditable
		};
		// Attachments can only be saved to libraries with file editing
		let targets = (response.targets || [])
			.filter(t => t.filesEditable)
			.map(t => ({ ...t, level: t.level || 0 }));
		let tags = {};
		for (let [libraryID, tagArr] of Object.entries(response.tags || {})) {
			tags[libraryID] = [...new Set(tagArr.map(item => item.tag))];
		}
		sendToProgressWindow('changeHeadline', [
			Zotero.getString('progressWindow_savingTo'), target, targets, tags
		]);
		// Restore changes made in a previous popup for this save
		if (session.userUpdate) {
			sendToProgressWindow('restoreUserInput', session.userUpdate);
		}
	}
	
	function startCloseTimer(delay) {
		if (hovering || closeTimerDisabled) return;
		stopCloseTimer();
		closeTimeoutID = setTimeout(() => window.close(), delay);
	}
	
	function stopCloseTimer() {
		clearTimeout(closeTimeoutID);
	}
};
