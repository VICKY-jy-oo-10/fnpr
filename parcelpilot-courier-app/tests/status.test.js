'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { canTransition, normalizeRole, SHIPMENT_STATUS } = require('../src/status');
const { generateAwb } = require('../src/services/awb');

test('role values normalize to canonical application roles', () => {
  assert.equal(normalizeRole('customer'), 'CUSTOMER');
  assert.equal(normalizeRole('Admin / Staff'), 'ADMIN');
  assert.equal(normalizeRole('deliveryExecutive'), 'COURIER');
  assert.equal(normalizeRole('unknown'), null);
});

test('shipment lifecycle accepts normal next steps and rejects invalid shortcuts', () => {
  assert.equal(canTransition('BOOKED', 'PICKUP_ASSIGNED', 'ADMIN'), true);
  assert.equal(canTransition('AT_DESTINATION_HUB', 'OUT_FOR_DELIVERY', 'COURIER'), true);
  assert.equal(canTransition('PICKUP_ASSIGNED', 'OUT_FOR_DELIVERY', 'COURIER'), true);
  assert.equal(canTransition('OUT_FOR_DELIVERY', 'DELIVERED', 'COURIER'), true);
  assert.equal(canTransition('BOOKED', 'DELIVERED', 'ADMIN'), false);
  assert.equal(canTransition('DELIVERED', 'IN_TRANSIT', 'ADMIN'), false);
  assert.equal(canTransition('BOOKED', 'PICKUP_ASSIGNED', 'CUSTOMER'), false);
});

test('AWB values follow the expected printable format and are distinct across repeated generation', () => {
  const a = generateAwb();
  const b = generateAwb();
  assert.match(a, /^PP\d{12}$/);
  assert.match(b, /^PP\d{12}$/);
  assert.notEqual(a, b);
});

test('central status model contains delivery close-out states', () => {
  assert.equal(SHIPMENT_STATUS.DELIVERED, 'DELIVERED');
  assert.equal(SHIPMENT_STATUS.RTO_DELIVERED, 'RTO_DELIVERED');
});
