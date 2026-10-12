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

import { Tab, background, getExtensionURL, delay, stubConnectorCallMethod } from '../support/utils.mjs';

var selectedCollectionResponse = {
	libraryID: 1,
	libraryName: 'My Library',
	libraryEditable: true,
	filesEditable: true,
	editable: true,
	id: 'C1',
	name: 'Collection 1',
	targets: [
		{ id: 'L1', name: 'My Library', filesEditable: true, level: 0 },
		{ id: 'C1', name: 'Collection 1', filesEditable: true, level: 1 },
		{ id: 'C2', name: 'Collection 2', filesEditable: true, level: 1 }
	]
};

async function navigateAndWaitForTranslators(tab, url) {
	let translatorsLoaded = background(function () {
		return new Promise((resolve) => {
			sinon.stub(Zotero.Connector_Browser, 'onTranslators').callsFake((...args) => {
				resolve(args[0].map(t => t.label));
				Zotero.Connector_Browser.onTranslators.wrappedMethod
					.apply(Zotero.Connector_Browser, args);
				Zotero.Connector_Browser.onTranslators.restore();
			});
		});
	});
	await tab.navigate(url);
	await translatorsLoaded;
}

describe("ProgressWindow", function () {
	var tab = new Tab();
	var url;
	
	before(async function () {
		url = getExtensionURL('test/data/journalArticle-single.html');
		// Make sure translators initialized
		await background(function () {
			return Zotero.Translators.get('c159dcfe-8a53-4301-a499-30f6549c340d');
		});
		await background(function () {
			sinon.stub(Zotero.Connector, 'checkIsOnline').resolves(true);
		});
		await tab.init(url);
	});
	
	beforeEach(async function () {
		await navigateAndWaitForTranslators(tab, url);
	});
	
	after(async function () {
		await background(function () {
			Zotero.Connector.checkIsOnline.restore();
		});
		await tab.close();
	});
	
	describe("Target selector", function () {
		// The popup runs in an extension frame and the session is updated by the injected script
		// that's saving, and messages take a different route between the two in Safari
		for (let isSafari of [false, true]) {
			it(`updates the session in the client when the target changes${isSafari ? ' in Safari' : ''}`, async function () {
				var wasSafari;
				let restoreStub = await stubConnectorCallMethod({
					saveItems: { returnPayload: true },
					getSelectedCollection: { response: selectedCollectionResponse },
					updateSession: { response: {} }
				});
				try {
					await background(async function (tabId) {
						let tab = await browser.tabs.get(tabId);
						return Zotero.Connector_Browser.saveWithTranslator(tab, 0);
					}, tab.tabId);
					
					let frameURL = getExtensionURL('progressWindow/progressWindow.html');
					let frame = await tab.page.waitForFrame(frame => frame.url().startsWith(frameURL));
					await frame.waitForSelector('.ProgressWindow-progressBox');
					
					wasSafari = await background(function (isSafari) {
						let wasSafari = Zotero.isSafari;
						Zotero.isSafari = isSafari;
						return wasSafari;
					}, isSafari);
					
					await frame.evaluate(function () {
						return Zotero.Messaging.sendMessage('progressWindowIframe.updated', {
							target: { id: 'C2', name: 'Collection 2', filesEditable: true },
							note: '',
							tags: []
						});
					});
					
					var payload;
					for (let i = 0; i < 20 && !payload; i++) {
						payload = await background(function () {
							let call = Zotero.Connector.callMethod.args
								.find(args => args[0] == 'updateSession');
							return call && call[1];
						});
						if (!payload) {
							await delay(50);
						}
					}
					
					assert.ok(payload, "updateSession is called in the client");
					assert.equal(payload.target, 'C2');
				}
				finally {
					if (wasSafari !== undefined) {
						await background(function (wasSafari) {
							Zotero.isSafari = wasSafari;
						}, wasSafari);
					}
					await restoreStub();
				}
			});
		}
	});
	
	// Used for Firefox PDFs, where we can't inject the progress window into the page. We can't
	// open the button popup here, so we load the popup page in a tab instead.
	describe("Extension button popup", function () {
		var popupPage;
		
		beforeEach(async function () {
			await background(function (tabId) {
				let tabInfo = Zotero.Connector_Browser.getTabInfo(tabId);
				tabInfo.uninjectable = true;
				tabInfo.isPDF = true;
				tabInfo.contentType = 'application/pdf';
				// saveWithoutProgressWindow() is only used in MV2
				browser.browserAction = browser.action;
				sinon.stub(Zotero.Connector, 'ping').resolves();
				sinon.stub(Zotero.ItemSaver, 'saveStandaloneAttachmentToZotero').callsFake(async () => {
					await Zotero.Promise.delay(300);
					return { canRecognize: false };
				});
			}, tab.tabId);
		});
		
		afterEach(async function () {
			await popupPage?.close().catch(() => {});
			popupPage = null;
			await background(function () {
				delete browser.browserAction;
				Zotero.Connector.ping.restore();
				Zotero.ItemSaver.saveStandaloneAttachmentToZotero.restore();
			});
		});
		
		async function openPopup() {
			popupPage = await browser.newPage();
			await popupPage.goto(getExtensionURL(`progressWindow/progressWindow.html?tabId=${tab.tabId}`));
			await popupPage.waitForSelector('.ProgressWindow-progressBox .ProgressWindow-item');
			await popupPage.waitForFunction(
				() => document.querySelector('.ProgressWindow-headlineSelect')
			);
			return popupPage;
		}
		
		async function getUpdateSessionPayload() {
			for (let i = 0; i < 40; i++) {
				let payload = await background(function () {
					let call = Zotero.Connector.callMethod.args
						.find(args => args[0] == 'updateSession');
					return call && call[1];
				});
				if (payload) return payload;
				await delay(50);
			}
		}
		
		it("saves the page and updates the session when the target changes", async function () {
			let restoreStub = await stubConnectorCallMethod({
				getSelectedCollection: { response: selectedCollectionResponse },
				updateSession: { response: {} }
			});
			try {
				let popup = await openPopup();
				let text = await popup.$eval('.ProgressWindow-progressBox', node => node.textContent);
				assert.include(text, await tab.page.title());
				assert.equal(await popup.$eval('.ProgressWindow-headlineSelect', node => node.value), 'C1');
				
				// Sent before the save completes, so it's queued until then
				await popup.evaluate(function () {
					Zotero.Messaging.sendMessage('progressWindowIframe.updated', {
						target: { id: 'C2', name: 'Collection 2', filesEditable: true },
						note: '',
						tags: ['tag1']
					});
				});
				let payload = await getUpdateSessionPayload();
				assert.ok(payload, "updateSession is called in the client");
				assert.equal(payload.target, 'C2');
				assert.deepEqual(payload.tags, ['tag1']);
				let sessionID = await background(function () {
					return Zotero.ItemSaver.saveStandaloneAttachmentToZotero.firstCall.args[1];
				});
				assert.equal(payload.sessionID, sessionID);
			}
			finally {
				await restoreStub();
			}
		});
		
		it("shows the existing save when reopened", async function () {
			let restoreStub = await stubConnectorCallMethod({
				getSelectedCollection: { response: selectedCollectionResponse },
				updateSession: { response: {} }
			});
			try {
				let popup = await openPopup();
				await popup.evaluate(function () {
					Zotero.Messaging.sendMessage('progressWindowIframe.updated', {
						target: { id: 'C2', name: 'Collection 2', filesEditable: true },
						note: '',
						tags: []
					});
				});
				assert.ok(await getUpdateSessionPayload());
				await popup.close();
				
				popup = await openPopup();
				await popup.waitForFunction(
					() => document.querySelector('.ProgressWindow-headlineSelect').value == 'C2'
				);
				let saveCount = await background(function () {
					return Zotero.ItemSaver.saveStandaloneAttachmentToZotero.callCount;
				});
				assert.equal(saveCount, 1);
			}
			finally {
				await restoreStub();
			}
		});
	});
});
