'use strict';
const store = require('../store');
const all = { mock: require('./mock'), runway: require('./runway') };

function active() { return all[store.db.settings.provider] || all.mock; }
function list() { return Object.values(all).map((p) => ({ name: p.name, label: p.label, supportsVideo: p.supportsVideo })); }

module.exports = { active, list, all };
