'use strict';
let util = require('util');

function RoundRobin() {
	this.index = 0;
}

util.inherits(RoundRobin, Array);

RoundRobin.prototype.next = function() {
	if (this.index >= this.length) {
		this.index = 0;
	}

	return this[this.index++];
};

module.exports = RoundRobin;
