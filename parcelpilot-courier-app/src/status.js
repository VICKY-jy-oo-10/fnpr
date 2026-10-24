'use strict';

const SHIPMENT_STATUS = Object.freeze({
  BOOKED: 'BOOKED',
  PICKUP_ASSIGNED: 'PICKUP_ASSIGNED',
  PICKED_UP: 'PICKED_UP',
  AT_ORIGIN_HUB: 'AT_ORIGIN_HUB',
  IN_TRANSIT: 'IN_TRANSIT',
  AT_DESTINATION_HUB: 'AT_DESTINATION_HUB',
  OUT_FOR_DELIVERY: 'OUT_FOR_DELIVERY',
  DELIVERED: 'DELIVERED',
  UNDELIVERED: 'UNDELIVERED',
  RTO_INITIATED: 'RTO_INITIATED',
  RTO_IN_TRANSIT: 'RTO_IN_TRANSIT',
  RTO_DELIVERED: 'RTO_DELIVERED',
  MISROUTE: 'MISROUTE',
  CANCELLED: 'CANCELLED'
});

const TRANSITIONS = Object.freeze({
  BOOKED: ['PICKUP_ASSIGNED', 'PICKED_UP', 'CANCELLED', 'MISROUTE'],
  PICKUP_ASSIGNED: ['PICKED_UP', 'UNDELIVERED', 'CANCELLED', 'MISROUTE'],
  PICKED_UP: ['AT_ORIGIN_HUB', 'IN_TRANSIT', 'UNDELIVERED', 'RTO_INITIATED', 'MISROUTE'],
  AT_ORIGIN_HUB: ['IN_TRANSIT', 'MISROUTE', 'RTO_INITIATED'],
  IN_TRANSIT: ['AT_DESTINATION_HUB', 'MISROUTE', 'RTO_INITIATED'],
  AT_DESTINATION_HUB: ['OUT_FOR_DELIVERY', 'IN_TRANSIT', 'MISROUTE', 'RTO_INITIATED'],
  OUT_FOR_DELIVERY: ['DELIVERED', 'UNDELIVERED', 'RTO_INITIATED', 'MISROUTE'],
  UNDELIVERED: ['OUT_FOR_DELIVERY', 'RTO_INITIATED', 'CANCELLED'],
  RTO_INITIATED: ['RTO_IN_TRANSIT', 'RTO_DELIVERED'],
  RTO_IN_TRANSIT: ['RTO_DELIVERED'],
  DELIVERED: [],
  RTO_DELIVERED: [],
  MISROUTE: ['IN_TRANSIT', 'AT_DESTINATION_HUB', 'RTO_INITIATED'],
  CANCELLED: []
});

function canTransition(current, next, actorRole = 'ADMIN') {
  if (!['ADMIN', 'COURIER'].includes(actorRole)) return false;
  if (!Object.hasOwn(TRANSITIONS, current) || !Object.hasOwn(TRANSITIONS, next)) return false;
  if (actorRole === 'COURIER') {
    const courierAllowed = {
      PICKUP_ASSIGNED: ['PICKED_UP', 'OUT_FOR_DELIVERY', 'UNDELIVERED'],
      AT_DESTINATION_HUB: ['OUT_FOR_DELIVERY'],
      OUT_FOR_DELIVERY: ['DELIVERED', 'UNDELIVERED', 'RTO_INITIATED'],
      UNDELIVERED: ['OUT_FOR_DELIVERY', 'RTO_INITIATED']
    };
    return (courierAllowed[current] || []).includes(next);
  }
  return TRANSITIONS[current].includes(next);
}

function normalizeRole(value) {
  const normalized = String(value ?? '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
  if (['admin', 'administrator', 'staff', 'admin_staff'].includes(normalized)) return 'ADMIN';
  if (['courier', 'delivery_executive', 'deliveryexecutive', 'delivery_staff'].includes(normalized)) return 'COURIER';
  if (['customer', 'client', 'user'].includes(normalized)) return 'CUSTOMER';
  return null;
}

module.exports = { SHIPMENT_STATUS, TRANSITIONS, canTransition, normalizeRole };
