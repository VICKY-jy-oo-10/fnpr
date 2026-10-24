'use strict';
const crypto = require('node:crypto');
function generateAwb() {
  const datePart = new Date().toISOString().slice(2, 10).replace(/-/g, '');
  const randomPart = crypto.randomInt(100000, 999999).toString();
  return `PP${datePart}${randomPart}`;
}
function generateReference(prefix) {
  const d = new Date();
  const date = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
  return `${prefix}-${date}-${crypto.randomInt(100000, 999999)}`;
}
module.exports = { generateAwb, generateReference };
