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

/**
 * Emulates very small parts of cachedTypes.js and itemFields.js APIs for use with connector
 */

/**
 * @namespace
 */
Zotero.Connector_Types = new function() {
	var icons = {};
	var iconsInitialized = false;
	/**
	 * Initializes types
	 * @param {Object} typeSchema typeSchema generated by Zotero.Connector.GetData#_generateTypeSchema
	 */
	this.init = async function() {
		const schemaTypes = ["itemTypes", "creatorTypes", "fields"];
		
		// attach IDs and make referenceable by either ID or name
		for(var i=0; i<schemaTypes.length; i++) {
			var schemaType = schemaTypes[i];
			this[schemaType] = Zotero.Utilities.deepCopy(Zotero.Connector_Types.schema[schemaType]);
			for(var id in Zotero.Connector_Types.schema[schemaType]) {
				var entry = this[schemaType][id];
				entry.unshift(parseInt(id, 10));
				this[schemaType][entry[1]/* name */] = entry;
			}
		}
			
		var itemTypes = Zotero.Connector_Types["itemTypes"];
		var creatorTypes = Zotero.Connector_Types["creatorTypes"];
		var fields = Zotero.Connector_Types["fields"];
		
		if (Zotero.isBrowserExt) {
			await this._initHiResIconList();
		}

		Zotero.CachedTypes = function() {
			var thisType = Zotero.Connector_Types[this.schemaType];
			
			this.getID = function(idOrName) {
				var type = thisType[idOrName];
				return (type ? type[0]/* id */ : false);
			};
			
			this.getName = function(idOrName) {
				var type = thisType[idOrName];
				return (type ? type[1]/* name */ : false);
			};
			
			this.getLocalizedString = function(idOrName) {
				var type = thisType[idOrName];
				return (type ? type[2]/* localizedString */ : false);
			};
		}
		
		Zotero.ItemTypes = new function() {
			this.schemaType = "itemTypes";
			Zotero.CachedTypes.call(this);
			
			this.getImageSrc = function(idOrName) {
				var itemType = Zotero.Connector_Types["itemTypes"][idOrName];
				var icon = itemType ? itemType[6]/* icon */ : "treeitem-"+idOrName+".png";
				
				if (Zotero.isBookmarklet) {
					return ZOTERO_CONFIG.BOOKMARKLET_URL + `images/${icon}`;
				} else if (Zotero.isBrowserExt) {
					if (!iconsInitialized) {
						return browser.extension.getURL(`images/${icon}`);
					}
					if (window.devicePixelRatio > 1 && icons[icon].hasHiRes) {
						return icons[icon].pathHiRes;
					}
					else {
						return icons[icon].path;
					}
				} else if (Zotero.isSafari) {
					if (typeof safari == "undefined") {
						return `images/${icon}`;
					}
					else {
						return `${safari.extension.baseURI}safari/images/${icon}`;
					}
				}
			};
		}
		
		Zotero.CreatorTypes = new function() {
			this.schemaType = "creatorTypes";
			Zotero.CachedTypes.call(this);
			
			this.getTypesForItemType = function(idOrName) {
				var itemType = itemTypes[idOrName];
				if(!itemType) return false;
				
				var itemCreatorTypes = itemType[3]; // creatorTypes
				if (!itemCreatorTypes
						// TEMP: 'note' and 'attachment' have an array containing false
						|| (itemCreatorTypes.length == 1 && !itemCreatorTypes[0])) {
					return [];
				}
				var n = itemCreatorTypes.length;
				var outputTypes = new Array(n);
				
				for(var i=0; i<n; i++) {
					var creatorType = creatorTypes[itemCreatorTypes[i]];
					outputTypes[i] = {"id":creatorType[0]/* id */,
						"name":creatorType[1]/* name */};
				}
				return outputTypes;
			};
			
			this.getPrimaryIDForType = function(idOrName) {
				var itemType = itemTypes[idOrName];
				if(!itemType) return false;
				return itemType[3]/* creatorTypes */[0];
			};
			
			this.isValidForItemType = function(creatorTypeID, itemTypeID) {
				let itemType = itemTypes[itemTypeID];
				return itemType[3]/* creatorTypes */.includes(creatorTypeID);
			};
		};
		
		Zotero.ItemFields = new function() {
			this.schemaType = "fields";
			Zotero.CachedTypes.call(this);
			
			this.isValidForType = function(fieldIdOrName, typeIdOrName) {
				var field = fields[fieldIdOrName], itemType = itemTypes[typeIdOrName];
				
				// mimics itemFields.js
				if(!field || !itemType) return false;
				
				       /* fields */        /* id */
				return itemType[4].indexOf(field[0]) !== -1;
			};
			
			this.isBaseField = function(fieldID) {
				return fields[fieldID][2];
			};
			
			this.getFieldIDFromTypeAndBase = function(typeIdOrName, fieldIdOrName) {
				var baseField = fields[fieldIdOrName], itemType = itemTypes[typeIdOrName];
				
				if(!baseField || !itemType) return false;
				
				// get as ID
				baseField = baseField[0]/* id */;
				
				// loop through base fields for item type
				var baseFields = itemType[5];
				for(var i in baseFields) {
					if(baseFields[i] === baseField) {
						return i;
					}
				}
				
				return false;
			};
			
			this.getBaseIDFromTypeAndField = function(typeIdOrName, fieldIdOrName) {
				var field = fields[fieldIdOrName], itemType = itemTypes[typeIdOrName];
				if(!field || !itemType) {
					throw new Error("Invalid field or type ID");
				}
				
				var baseField = itemType[5]/* baseFields */[field[0]/* id */];
				return baseField ? baseField : false;
			};
			
			this.getItemTypeFields = function(typeIdOrName) {
				return itemTypes[typeIdOrName][4]/* fields */.slice();
			};
		}
	};
	
	/**
	 * Passes schema to a callback
	 * @param {Function} callback
	 */
	this.getSchema = function(callback) {
		callback(Zotero.Connector_Types.schema);
	};
	
	this._initHiResIconList = async function() {
		try {
			const rootDirectory = await browser.runtime.getPackageDirectoryEntry();
			const imagesDirectory = await new Promise((resolve, reject) =>
				rootDirectory.getDirectory('images', {}, resolve, reject)) ;
			// N.B. Returns a FileSystemDirectoryReader which according to MDN is an experimental
			// feature not on standards track, although available on all browsers.
			// Still, could break at some point. See
			// https://developer.mozilla.org/en-US/docs/Web/API/FileSystemDirectoryReader
			const reader = imagesDirectory.createReader();
			const entries = await new Promise((resolve, reject) => 
				reader.readEntries(resolve, reject));
			for (const entry of entries) {
				if (entry.isDirectory) continue;
				let ext = entry.name.substr(entry.name.lastIndexOf('.'));
				let name = entry.name.substring(0, entry.name.length - ext.length);
				let hasHiRes = false;
				if (name.endsWith('@2x')) {
					name = name.substring(0, name.length - 3);
					hasHiRes = true;
				}
				const iconName = name + ext;
				if (!(iconName in icons)) {
					icons[iconName] = { path: browser.extension.getURL(`images/${iconName}`) };
				}
				if (hasHiRes) {
					icons[iconName].hasHiRes = true;
					icons[iconName].pathHiRes = browser.extension.getURL(`images/${name}@2x${ext}`);
				}
			}
			iconsInitialized = true;
		}
		catch (e) {
			Zotero.debug("Failed to initialize list of Hi-Res icons", 1);
			Zotero.logError(e);
		}
	}
}