/*
	***** BEGIN LICENSE BLOCK *****
	
	Copyright © 2017 Center for History and New Media
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

describe("Connector", function() {

	describe('#getSelectedCollection()', function() {
		it('throws if Zotero is offline', Promise.coroutine(function* () {
			try {
				yield background(function() {
					Zotero.Connector.isOnline = false;
					return Zotero.Connector.getSelectedCollection()
				});
			} catch (e) {
				assert.equal(e.status, 0);
				return;
			}
			throw new Error('Error not thrown');
		}));
	
		it('gets an SSE result if SSE available', Promise.coroutine(function*() {
			let s = yield background(function() {
				Zotero.Connector.isOnline = true;
				Zotero.Connector.SSE.available = true;
				Zotero.Connector.selected = {collection: 'selected'};
				return Zotero.Connector.getSelectedCollection()
			});
			assert.equal(s, 'selected');
		}));
		it('calls Zotero if SSE unavailable', Promise.coroutine(function*() {
			let call = yield background(function() {
				Zotero.Connector.isOnline = true;
				Zotero.Connector.SSE.available = false;
				Zotero.Connector.selected = {collection: 'selected'};
				sinon.stub(Zotero.Connector, 'callMethod');
				return Zotero.Connector.getSelectedCollection().then(function() {
					let call = Zotero.Connector.callMethod.lastCall;
					Zotero.Connector.callMethod.restore();
					return call
				});
			});
			assert.equal(call.args[0], 'getSelectedCollection');	
		}));
	})

});