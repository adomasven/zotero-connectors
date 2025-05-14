/**
 * @param func {Function}
 * @params {Object} ... parameters to be passed into the function to be run
 * @returns {Promise} return value of the function
 */
var background = async function (func, ...args) {
	return worker.evaluate(func, ...args);
};

var Tab = function() {};
Tab.prototype = {
	init: async function (url='http://zotero-static.s3.amazonaws.com/test.html') {
		this.page = await browser.newPage();
		await this.page.goto(url);
		this.tabId = await background(async () => {
			let tabs = await browser.tabs.query({ active: true });
			return tabs[0].id;
		});
		// await this.setupZoteroProxy();
	},
	
	navigate: async function (url) {
		if (this.page == undefined) {
			throw new Error('Must run Tab#init() before Tab#run');
		}
		await this.page.goto(url);
		// await this.setupZoteroProxy();
	},

	setupZoteroProxy: async function () {
		await this.page.evaluate(() => {
			window.__zoteroTestCallbacks = {};
			// Proxy calls to Zotero and sinon to content scripts via message passing. See testInject.js
			window.addEventListener('message', (event) => {
				if (event.data.type === 'zotero-test-callback') {
					let { result, id, index } = event.data;
					console.log(`Received callback ${id} ${index} with ${result}`);
					window.__zoteroTestCallbacks[id][index] = result;
				}
			});
			let fnBuilderProxy = function(fnName = []) {
				return new Proxy(() => {}, {
					get(target, prop) {
						if (prop !== 'fnName') {
							fnName.push(prop);
							return fnBuilderProxy(fnName);
						}
						else return fnName.join('.');
					},
					apply(target, thisArg, args) {
						// Random 6 char string
						const id = Math.random().toString(36).substring(2, 8);
						const { resolve, reject, promise } = Promise.withResolvers();
						console.log(`Invoking ${fnName.join('.')} with ID ${id}`);
						window.__zoteroTestCallbacks[id] = { "-1": (result) => {
								if (result?.error) reject(result.error);
								resolve(result);
							}
						};
						args.forEach((arg, index) => {
							if (typeof arg === 'function') {
								window.__zoteroTestCallbacks[id][index] = arg;
								args[index] = '__function';
							}
						});
						window.postMessage({ type: 'zotero-test-exec', fnName: fnName.join('.'), args, id }, '*');
						return promise;
					}
				});
			};
			window.Zotero = fnBuilderProxy(['Zotero']);
			window.sinon = fnBuilderProxy(['sinon']);
		})
	},
	
	run: async function (fn, ...args) {
		return await this.page.evaluate(fn, ...args);
	},
	
	runInFrame: async function(frameUrl, fn, ...args) {
		let frame = await this.page.frames().find(f => f.url() === frameUrl);
		if (!frame) {
			throw new Error(`Frame with URL ${frameUrl} not found`);
		}
		return await frame.evaluate(fn, ...args);
	},

	close: async function () {
		if (this.page == undefined) {
			throw new Error('Must run Tab#init() before Tab#close');
		}
		await this.page.close();
		delete this.page;
	}
};

function delay(ms) {	
	return new Promise(resolve => setTimeout(resolve, ms));
}

function getExtensionURL(path) {
	return `${extensionURL}${path}`;
}

export { background, Tab, delay, getExtensionURL };