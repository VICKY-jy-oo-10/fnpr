(function () {
  'use strict';

  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
  const state = {
    user: null,
    page: 'dashboard',
    pageData: null,
    search: '',
    statusFilter: '',
    socket: null,
    activeTracking: null,
    maps: {},
    locationWatchId: null,
    lastLocationSentAt: 0,
    liveLocations: []
  };

  const SHIP_STATUS = [
    'BOOKED','PICKUP_ASSIGNED','PICKED_UP','AT_ORIGIN_HUB','IN_TRANSIT','AT_DESTINATION_HUB',
    'OUT_FOR_DELIVERY','DELIVERED','UNDELIVERED','RTO_INITIATED','RTO_IN_TRANSIT','RTO_DELIVERED','MISROUTE','CANCELLED'
  ];
  const ICONS = {
    dashboard: '▦', live: '✣', shipments: '□', bookings: '＋', drs: '▤', pickups: '↙',
    pod: '▣', couriers: '♟', customers: '♙', reports: '◔', finance: '₹', sync: '↻',
    audit: '≋', notifications: '♢', tracking: '⌖', profile: '◉', help: '✦'
  };

  const NAV = {
    ADMIN: [
      { section: 'OPERATIONS', links: [
        ['dashboard', 'Overview', 'dashboard'], ['live', 'Live operations', 'live', '3'],
        ['shipments', 'Shipments', 'shipments'], ['bookings', 'Booking new / old', 'bookings'], ['delivery-entry', 'Delivery entry', 'shipments'], ['drs', 'Delivery runs', 'drs'], ['pickups', 'Pickups', 'pickups']
      ]},
      { section: 'MANAGE', links: [
        ['couriers', 'Couriers', 'couriers'], ['customers', 'Customers', 'customers'], ['reports', 'Reports', 'reports'],
        ['finance', 'Digital accounts', 'finance'], ['sync', 'Sync centre', 'sync'], ['audit', 'Audit logs', 'audit'], ['notifications', 'Notifications', 'notifications']
      ]}
    ],
    COURIER: [
      { section: 'MY WORK', links: [
        ['dashboard', 'Today', 'dashboard'], ['shipments', 'Assigned deliveries', 'shipments'], ['delivery-entry', 'Delivery entry', 'shipments'], ['drs', 'Delivery runs', 'drs'],
        ['pickups', 'Pickup tasks', 'pickups'], ['pod', 'Proof of delivery', 'pod'], ['sync', 'Sync centre', 'sync'], ['notifications', 'Notifications', 'notifications']
      ]}
    ],
    CUSTOMER: [
      { section: 'MY PARCELS', links: [
        ['dashboard', 'Home', 'dashboard'], ['track', 'Track shipment', 'tracking'], ['shipments', 'My shipments', 'shipments'],
        ['pickups', 'Request pickup', 'pickups'], ['notifications', 'Notifications', 'notifications'], ['profile', 'My profile', 'profile']
      ]}
    ]
  };
  const TITLES = {
    dashboard: ['Overview', 'Your courier operations at a glance'], live: ['Live operations', 'Track active deliveries and courier activity in real time'],
    shipments: ['Shipments', 'Search, assign and manage every shipment lifecycle'], bookings: ['Bookings · New / Old', 'Create a booking or reuse an existing shipment as a template'], 'delivery-entry': ['Delivery entry', 'Find an AWB and enter a verified operational status update'], drs: ['Delivery runs', 'Generate delivery run sheets and review assigned routes'],
    pickups: ['Pickups', 'Coordinate pickup requests and collection tasks'], pod: ['Proof of delivery', 'Review delivery confirmation and receiver records'],
    couriers: ['Couriers', 'Manage delivery executives and workload'], customers: ['Customers', 'Customer directory and shipment relationships'],
    reports: ['Reports & analytics', 'Operational performance and delivery health'], finance: ['Digital accounts', 'Income, expenses and financial records'],
    sync: ['Sync centre', 'Review record persistence and synchronization activity'], audit: ['Audit logs', 'A traceable record of important operational actions'],
    notifications: ['Notifications', 'Shipment updates and operational alerts'], track: ['Track shipment', 'Get a secure status timeline for your AWB'], profile: ['My profile', 'Account details and current access role']
  };

  function esc(value) {
    return String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
  }
  function num(value) { return new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 }).format(Number(value || 0)); }
  function money(value) { return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(Number(value || 0)); }
  function dateLabel(value, withTime = false) {
    if (!value) return '—';
    const parsed = new Date(value.includes?.(' ') && !value.includes('T') ? `${value.replace(' ', 'T')}Z` : value);
    if (Number.isNaN(parsed.getTime())) return value;
    return new Intl.DateTimeFormat('en-IN', withTime ? { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' } : { day: '2-digit', month: 'short', year: 'numeric' }).format(parsed);
  }
  function initials(name) { return String(name || 'U').split(/\s+/).slice(0, 2).map((x) => x[0] || '').join('').toUpperCase(); }
  function prettyStatus(status) { return String(status || 'UNKNOWN').replaceAll('_', ' ').toLowerCase().replace(/\b\w/g, (m) => m.toUpperCase()); }
  function statusTone(status) {
    if (['DELIVERED', 'RTO_DELIVERED', 'COMPLETED', 'SYNCED'].includes(status)) return 'good';
    if (['UNDELIVERED', 'RTO_INITIATED', 'RTO_IN_TRANSIT', 'MISROUTE', 'FAILED', 'CANCELLED'].includes(status)) return 'danger';
    if (['OUT_FOR_DELIVERY', 'PICKUP_ASSIGNED', 'IN_TRANSIT', 'PENDING', 'ASSIGNED', 'IN_PROGRESS'].includes(status)) return 'warning';
    if (['BOOKED', 'PICKED_UP', 'AT_ORIGIN_HUB', 'AT_DESTINATION_HUB', 'OPEN', 'REQUESTED'].includes(status)) return 'info';
    return '';
  }
  function chip(status) { return `<span class="status-chip ${statusTone(status)}">${esc(prettyStatus(status))}</span>`; }
  function toast(message, type = 'info') {
    const root = $('#toast-root');
    const node = document.createElement('div');
    node.className = `toast ${type === 'error' ? 'error' : type === 'success' ? 'success' : ''}`;
    node.innerHTML = `<span>${type === 'error' ? '!' : type === 'success' ? '✓' : '✦'}</span><span>${esc(message)}</span>`;
    root.appendChild(node);
    setTimeout(() => node.remove(), 3600);
  }
  function errorMessage(err) {
    // A 401 during login is not necessarily an expired session.
    if (err?.status === 401 && state.user) return 'Your session expired. Please sign in again.';
    return err?.message || 'Something went wrong. Please retry.';
  }
  function showError(err) {
    toast(errorMessage(err), 'error');
    if (err?.status === 401 && state.user) logout(false);
  }
  function btn(label, action, cls = 'btn-outline', attrs = '') {
    return `<button class="btn ${cls}" data-action="${esc(action)}" ${attrs}>${label}</button>`;
  }
  function heading(title, subtitle, actions = '') {
    return `<div class="page-heading"><div><h1>${esc(title)}</h1><p>${esc(subtitle)}</p></div><div class="heading-actions">${actions}</div></div>`;
  }
  function kpi(label, value, icon, foot = '') {
    return `<section class="kpi-card"><div class="kpi-top"><div class="kpi-label">${esc(label)}</div><span class="kpi-icon">${esc(icon)}</span></div><div class="kpi-value">${esc(value)}</div><div class="kpi-foot">${foot}</div></section>`;
  }
  function emptyState(title, copy, icon = '□', action = '') {
    return `<div class="empty-state"><div class="empty-icon">${esc(icon)}</div><strong>${esc(title)}</strong><p>${esc(copy)}</p>${action}</div>`;
  }
  function cellPrimary(main, sub = '') { return `<span class="cell-primary">${esc(main || '—')}</span>${sub ? `<span class="cell-secondary">${esc(sub)}</span>` : ''}`; }

  function renderRoleSelection() {
    state.user = null;
    $('#app').innerHTML = `
      <div class="auth-layout">
        <section class="auth-brand-panel">
          <div class="brand-lockup"><span class="brand-mark auth-mark">P</span><div>parcel<span>pilot</span></div></div>
          <div class="auth-hero">
            <div class="eyebrow">Courier management platform</div>
            <h1>Every parcel.<br>Every route.<br><span style="color:#b7a5ff">Under control.</span></h1>
            <p>One connected workspace for shipment operations, courier teams and customers — from booking to proof of delivery.</p>
            <div class="feature-stack">
              <div class="feature-line"><span class="feature-icon">⌖</span> Live shipment and courier visibility</div>
              <div class="feature-line"><span class="feature-icon">▤</span> Delivery runs, pickups and POD records</div>
              <div class="feature-line"><span class="feature-icon">↗</span> Operational insights and digital accounts</div>
            </div>
          </div>
          <div class="eyebrow">Secure · Real-time · Reliable</div>
        </section>
        <section class="auth-panel"><div class="auth-card">
          <div class="eyebrow">Welcome to ParcelPilot</div><h2>Welcome back.</h2>
          <p class="auth-intro">Choose how you want to continue. Your account permissions determine what you can access.</p>
          <div class="role-options">
            <button class="role-card" data-action="choose-role" data-role="CUSTOMER"><span class="role-icon">♙</span><span class="role-copy"><strong>Customer</strong><small>Track your shipment securely</small></span><span class="role-arrow">›</span></button>
            <button class="role-card" data-action="choose-role" data-role="ADMIN"><span class="role-icon">▦</span><span class="role-copy"><strong>Admin / Staff</strong><small>Manage operations and deliveries</small></span><span class="role-arrow">›</span></button>
            <button class="role-card" data-action="choose-role" data-role="COURIER"><span class="role-icon">⌖</span><span class="role-copy"><strong>Delivery Executive</strong><small>Manage your assigned route</small></span><span class="role-arrow">›</span></button>
          </div>
          <div class="demo-hint"><strong>Demo workspace</strong><br>Admin: <b>admin@parcelpilot.test</b> · Courier: <b>courier@parcelpilot.test</b><br>Passwords are listed in the project README. Customer OTP is shown on screen in development mode.</div>
        </div></section>
      </div>`;
  }

  function renderLogin(role, otpMode = false, context = {}) {
    const admin = role === 'ADMIN';
    const courier = role === 'COURIER';
    const title = admin ? 'Admin / Staff sign in' : courier ? 'Delivery executive sign in' : otpMode ? 'Verify your mobile' : 'Sign in as customer';
    const subtitle = admin ? 'Use your authorized workplace account to manage operations.' : courier ? 'Sign in to see your assigned deliveries and pickup tasks.' : otpMode ? `Enter the verification code sent to ${context.phone || 'your mobile number'}.` : 'Use your mobile number to access your shipment history and live tracking.';
    const content = role === 'CUSTOMER'
      ? (!otpMode ? `<form class="form-stack" data-form="customer-phone"><div class="field"><label for="customer-phone">Mobile number with country code</label><input class="input" id="customer-phone" name="phone" type="tel" placeholder="+91 98765 43210" required minlength="10" autocomplete="tel" value="${esc(context.phone || '')}"><small class="field-help">Demo mode displays a development OTP after requesting it.</small></div><div class="form-actions"><button class="btn btn-quiet" type="button" data-action="back-to-roles">← Back</button><button class="btn btn-primary" type="submit">Generate OTP <span>→</span></button></div></form>`
        : `<form class="form-stack" data-form="customer-otp"><input type="hidden" name="phone" value="${esc(context.phone || '')}"><div class="field"><label for="customer-name">Your name (only for a new account)</label><input class="input" id="customer-name" name="name" placeholder="Full name" autocomplete="name" value="${esc(context.name || '')}"></div><div class="field"><label for="otp-code">6-digit verification code</label><input class="input" id="otp-code" name="otp" inputmode="numeric" pattern="[0-9]{6}" maxlength="6" placeholder="••••••" required autocomplete="one-time-code"></div>${context.demoCode ? `<div class="alert info">Demo OTP: <strong>${esc(context.demoCode)}</strong> · This code is development-only.</div>` : ''}<div class="form-actions"><button class="btn btn-quiet" type="button" data-action="back-to-phone" data-phone="${esc(context.phone || '')}">← Change number</button><button class="btn btn-primary" type="submit">Verify & continue <span>→</span></button></div></form>`)
      : `<form class="form-stack" data-form="staff-login"><input type="hidden" name="role" value="${role}"><div class="field"><label for="work-email">Work email</label><input class="input" type="email" id="work-email" name="email" required autocomplete="username" placeholder="name@company.com" value="${courier ? 'courier@parcelpilot.test' : 'admin@parcelpilot.test'}"></div><div class="field"><label for="work-password">Password</label><input class="input" type="password" id="work-password" name="password" required autocomplete="current-password" placeholder="Enter password"></div><div class="form-actions"><button class="btn btn-quiet" type="button" data-action="back-to-roles">← Back</button><button class="btn btn-primary" type="submit">Sign in <span>→</span></button></div></form>`;
    $('#app').innerHTML = `<div class="auth-layout"><section class="auth-brand-panel"><div class="brand-lockup"><span class="brand-mark auth-mark">P</span><div>parcel<span>pilot</span></div></div><div class="auth-hero"><div class="eyebrow">Courier management platform</div><h1>Move work<br>forward.</h1><p>Secure access for every role. Your dashboard and permitted actions are resolved from your actual account.</p><div class="feature-stack"><div class="feature-line"><span class="feature-icon">✓</span> Role-based workspace access</div><div class="feature-line"><span class="feature-icon">⌖</span> Shipment and route visibility</div></div></div><div class="eyebrow">Secure · Real-time · Reliable</div></section><section class="auth-panel"><div class="auth-card"><div class="eyebrow">${admin ? 'Operations workspace' : courier ? 'Courier workspace' : 'Customer workspace'}</div><h2>${esc(title)}</h2><p class="auth-intro">${esc(subtitle)}</p>${content}<div class="footer-note">By continuing, you agree to use this workspace in accordance with your assigned role.</div></div></section></div>`;
  }

  async function authMe() {
    try {
      const result = await Api.get('/auth/me');
      await setUser(result.user, false);
    } catch {
      renderRoleSelection();
    }
  }
  async function setUser(user, showToast = true) {
    state.user = user;
    state.page = 'dashboard';
    state.search = '';
    state.statusFilter = '';
    if (state.socket) state.socket.disconnect();
    state.socket = window.io ? window.io({ transports: ['websocket', 'polling'] }) : null;
    if (state.socket) {
      state.socket.on('connect_error', () => {});
      state.socket.on('shipment:updated', (event) => {
        if (state.page === 'track' && state.activeTracking) {
          trackAwb(state.activeTracking.shipment.awb, false);
        } else if (state.page === 'dashboard' || state.page === 'shipments' || state.page === 'live' || state.page === 'drs') {
          toast(`${event.awb || 'Shipment'} · ${prettyStatus(event.status)}`, 'success');
          loadPage(state.page);
        }
      });
      state.socket.on('courier:location', (point) => {
        if (state.activeTracking?.shipment?.id === point.shipmentId) {
          state.activeTracking.location = point;
          updateTrackingLocation(point);
        }
        if (state.page === 'live' || state.page === 'dashboard') refreshLivePoint(point);
      });
    }
    stopLocationWatch();
    renderShell();
    if (showToast) toast(`Welcome, ${user.name.split(' ')[0]}.`, 'success');
  }
  async function logout(callApi = true) {
    stopLocationWatch();
    Object.values(state.maps).forEach((map) => { try { map.remove(); } catch {} });
    state.maps = {};
    if (state.socket) state.socket.disconnect();
    state.socket = null;
    state.activeTracking = null;
    if (callApi) await Api.post('/auth/logout', {}).catch(() => {});
    state.user = null;
    renderRoleSelection();
  }

  function navItems() { return NAV[state.user?.role] || []; }
  function renderShell() {
    const user = state.user;
    const title = TITLES[state.page] || TITLES.dashboard;
    const nav = navItems().map((group) => `<div class="nav-group-label">${esc(group.section)}</div><div class="nav-list">${group.links.map(([key, label, icon, count]) => `<button class="nav-link ${state.page === key ? 'active' : ''}" data-action="navigate" data-page="${key}"><span class="nav-icon">${ICONS[icon] || '·'}</span><span>${esc(label)}</span>${count && user.role === 'ADMIN' ? `<span class="nav-count">${count}</span>` : ''}</button>`).join('')}</div>`).join('');
    $('#app').innerHTML = `<div class="app-shell"><aside class="sidebar" id="sidebar"><div class="workspace-picker"><span class="workspace-avatar">NS</span><div class="workspace-name"><strong>Northstar Express</strong><small>${user.role === 'ADMIN' ? 'Operations workspace' : user.role === 'COURIER' ? 'Delivery workspace' : 'Customer account'}</small></div><span>⌄</span></div>${nav}<div class="sidebar-spacer"></div><div class="help-card"><span style="font-size:20px">${ICONS.help}</span><div><strong>Need a hand?</strong><small>Open operator guide</small></div></div><div class="user-mini"><span class="user-avatar">${esc(initials(user.name))}</span><div><strong>${esc(user.name)}</strong><small>${esc(roleLabel(user.role))} · Active</small></div><button class="logout-icon" data-action="logout" aria-label="Log out" title="Log out">↪</button></div></aside><div class="main-column"><header class="topbar"><div class="topbar-left"><button class="icon-button mobile-menu" data-action="toggle-menu" aria-label="Open menu">☰</button><div class="page-crumb"><strong>${esc(title[0])}</strong><small>Northstar Express <span style="color:#b5c1d0">/</span> ${esc(title[0])}</small></div></div><div class="topbar-right"><div class="global-search"><span class="search-glyph">⌕</span><input class="input" placeholder="Search AWB, customer…" id="global-search" aria-label="Global search"></div><button class="icon-button" data-action="navigate" data-page="notifications" title="Notifications">♧<span class="notification-dot"></span></button><div class="top-user"><span class="user-avatar">${esc(initials(user.name))}</span><div class="user-copy"><strong>${esc(user.name)}</strong><small>${esc(roleLabel(user.role))}</small></div></div></div></header><main class="content" id="page-content"><div class="empty-state"><div class="loader-ring" style="border-color:#e0e3f5;border-top-color:#655cff;margin:0 auto 14px"></div><strong>Loading workspace</strong><p>Fetching your operational data…</p></div></main></div></div>`;
    loadPage(state.page);
  }
  function roleLabel(role) { return role === 'ADMIN' ? 'Operations manager' : role === 'COURIER' ? 'Delivery executive' : 'Customer account'; }
  function setPage(page) {
    const allowed = navItems().flatMap((x) => x.links.map((l) => l[0]));
    if (!allowed.includes(page)) { toast('This page is not available for your role.', 'error'); return; }
    state.page = page;
    state.search = '';
    state.statusFilter = '';
    $('#sidebar')?.classList.remove('open');
    renderShell();
  }

  async function loadPage(page) {
    const content = $('#page-content');
    if (!content || !state.user) return;
    content.innerHTML = `<div class="empty-state"><div class="loader-ring" style="border-color:#e0e3f5;border-top-color:#655cff;margin:0 auto 14px"></div><strong>Loading ${esc((TITLES[page] || TITLES.dashboard)[0].toLowerCase())}</strong><p>Getting the latest data from ParcelPilot…</p></div>`;
    try {
      const pages = {
        dashboard: renderDashboard, live: renderLiveOperations, shipments: renderShipments, bookings: renderBookings, 'delivery-entry': renderDeliveryEntry, drs: renderDrs,
        pickups: renderPickups, pod: renderPod, couriers: renderCouriers, customers: renderCustomers,
        reports: renderReports, finance: renderFinance, sync: renderSync, audit: renderAudit,
        notifications: renderNotifications, track: renderTrack, profile: renderProfile
      };
      const result = await (pages[page] || renderDashboard)();
      if (state.page !== page || !$('#page-content')) return;
      state.pageData = result.data || null;
      content.innerHTML = result.html;
      mountPage(page, result.data || {});
    } catch (err) {
      if (!$('#page-content')) return;
      content.innerHTML = `<section class="panel"><div class="panel-body">${emptyState('Unable to load this page', errorMessage(err), '!', `<button class="btn btn-primary" data-action="retry-page">Try again</button>`)}</div></section>`;
      if (err?.status === 401) logout(false);
    }
  }

  async function renderDashboard() {
    const { summary = {}, statuses = [], recent = [], admin } = await Api.get('/reports/dashboard');
    let extra = '';
    let actions = '';
    if (state.user.role === 'ADMIN') {
      actions = btn('＋ Create booking', 'new-booking', 'btn-primary');
      extra = `<div class="dashboard-grid"><section class="panel"><div class="panel-header"><div><div class="panel-title">Live courier activity</div><div class="panel-subtitle">Latest available field locations · Open live operations for details</div></div>${btn('View live map →', 'navigate', 'btn-outline', 'data-page="live"')}</div><div class="panel-body"><div class="map-frame" id="dashboard-map"></div><div class="map-legend" style="margin-top:13px"><span class="legend-item"><span class="legend-dot"></span> Active courier</span><span class="legend-item"><span class="legend-dot green"></span> Delivery destination</span><span style="margin-left:auto">OpenStreetMap</span></div></div></section><section class="panel"><div class="panel-header"><div><div class="panel-title">Shipment status</div><div class="panel-subtitle">Current shipment distribution</div></div></div><div class="panel-body">${renderStatusBars(statuses)}</div></section></div><div class="dashboard-grid"><section class="panel"><div class="panel-header"><div><div class="panel-title">Weekly shipment activity</div><div class="panel-subtitle">Bookings and delivered parcels · last 7 days</div></div></div><div class="panel-body">${renderMiniChart(admin?.daily || [])}</div></section><section class="panel"><div class="panel-header"><div><div class="panel-title">Courier performance</div><div class="panel-subtitle">Assigned workload and completion</div></div></div><div class="panel-body">${renderCourierPerformance(admin?.courierPerformance || [])}</div></section></div>`;
    } else if (state.user.role === 'COURIER') {
      actions = btn('View assigned deliveries', 'navigate', 'btn-primary', 'data-page="shipments"');
      extra = `<div class="dashboard-grid"><section class="panel"><div class="panel-header"><div><div class="panel-title">Your route at a glance</div><div class="panel-subtitle">Start an eligible delivery to share location</div></div></div><div class="panel-body">${renderCourierTaskList(recent)}</div></section><section class="panel"><div class="panel-header"><div><div class="panel-title">Shipment status</div><div class="panel-subtitle">Your assigned shipment state</div></div></div><div class="panel-body">${renderStatusBars(statuses)}</div></section></div>`;
    } else {
      actions = btn('Track a shipment', 'navigate', 'btn-primary', 'data-page="track"');
      extra = `<div class="dashboard-grid"><section class="panel"><div class="panel-header"><div><div class="panel-title">Track a parcel</div><div class="panel-subtitle">Enter your AWB to see the latest movement</div></div></div><div class="panel-body"><form class="form-stack" data-form="quick-track"><div class="field"><label for="quick-awb">Air Waybill (AWB) number</label><input class="input" id="quick-awb" name="awb" placeholder="e.g. PP2610010001" required></div><button class="btn btn-primary" type="submit">Track shipment →</button></form><div class="field-help" style="margin-top:12px">Tracking and live courier visibility are limited to shipments linked to your signed-in account.</div></div></section><section class="panel"><div class="panel-header"><div><div class="panel-title">Shipment status</div><div class="panel-subtitle">Your parcel overview</div></div></div><div class="panel-body">${renderStatusBars(statuses)}</div></section></div>`;
    }
    return { html: `${heading(state.user.role === 'ADMIN' ? 'Good morning, ' + state.user.name.split(' ')[0] : state.user.role === 'COURIER' ? 'Your delivery day' : 'Your shipment overview', state.user.role === 'ADMIN' ? 'Here is what is happening across your network today.' : state.user.role === 'COURIER' ? 'Your assigned deliveries, pickups and completion status.' : 'Follow your parcels and review recent shipment updates.', actions)}
      <div class="kpi-grid">${kpi(state.user.role === 'CUSTOMER' ? 'MY SHIPMENTS' : 'TOTAL SHIPMENTS', num(summary.totalShipments), '▤', '<span class="positive">●</span> Current workspace')}${kpi(state.user.role === 'CUSTOMER' ? 'IN TRANSIT' : 'PENDING DELIVERIES', num(summary.active), '⌖', 'Not yet closed')}${kpi('OUT FOR DELIVERY', num(summary.outForDelivery), '↗', 'Active delivery runs')}${kpi('DELIVERED', num(summary.delivered), '✓', 'Confirmed complete')}</div>${extra}
      <section class="table-panel"><div class="panel-header"><div><div class="panel-title">Recent shipments</div><div class="panel-subtitle">Latest parcel activity</div></div>${btn('View all →', 'navigate', 'btn-outline', 'data-page="shipments"')}</div>${renderRecentTable(recent)}</section><div class="footer-note">ParcelPilot operations workspace · Data is served by your local backend</div>`, data: { statuses, recent, admin } };
  }

  function renderStatusBars(statuses) {
    if (!statuses.length) return emptyState('No shipment activity yet', 'New shipments will appear here after a booking is created.', '▤');
    const total = statuses.reduce((sum, item) => sum + Number(item.count), 0) || 1;
    const top = [...statuses].sort((a, b) => b.count - a.count).slice(0, 7);
    return `<div class="status-bars">${top.map((item, index) => `<div class="status-row"><div class="status-label">${esc(prettyStatus(item.status))}</div><div class="status-track"><div class="status-fill" style="width:${Math.max(2, Math.round(item.count / total * 100))}%;opacity:${Math.max(.45, 1 - index * .08)}"></div></div><div class="status-count">${num(item.count)}</div></div>`).join('')}</div>`;
  }
  function renderRecentTable(rows) {
    if (!rows.length) return emptyState('No shipments yet', 'Create your first booking to start seeing activity.', '▤');
    return `<div class="table-scroll"><table><thead><tr><th>AWB / parcel</th><th>Receiver</th><th>Destination</th><th>Status</th><th>Booked</th></tr></thead><tbody>${rows.map((row) => `<tr><td>${cellPrimary(row.awb, 'Shipment tracking')}</td><td>${cellPrimary(row.receiver_name)}</td><td>${esc(row.receiver_city || '—')}</td><td>${chip(row.status)}</td><td>${esc(dateLabel(row.created_at))}</td></tr>`).join('')}</tbody></table></div>`;
  }
  function renderMiniChart(rows) {
    if (!rows.length) return emptyState('Not enough activity', 'Daily booking trends will appear as shipment activity is recorded.', '▥');
    const max = Math.max(1, ...rows.map((r) => Math.max(Number(r.bookings || 0), Number(r.delivered || 0))));
    return `<div class="chart-bars">${rows.map((r) => `<div class="chart-col"><div class="chart-bar-pair"><div class="chart-bar" style="height:${Math.max(3, Number(r.bookings || 0) / max * 100)}%" title="${num(r.bookings)} bookings"></div><div class="chart-bar alt" style="height:${Math.max(3, Number(r.delivered || 0) / max * 100)}%" title="${num(r.delivered)} delivered"></div></div><span class="chart-label">${esc(String(r.day || '').slice(5))}</span></div>`).join('')}</div><div class="map-legend" style="margin-top:14px"><span class="legend-item"><span class="legend-dot" style="background:#7d73ff"></span> Bookings</span><span class="legend-item"><span class="legend-dot" style="background:#80d7cf"></span> Delivered</span></div>`;
  }
  function renderCourierPerformance(rows) {
    if (!rows.length) return emptyState('No courier records', 'Add authorized delivery executive accounts to review performance.', '♟');
    return `<div class="activity-list">${rows.slice(0, 5).map((r) => `<div class="activity-item"><div class="user-avatar">${esc(initials(r.courier))}</div><div class="activity-copy"><strong>${esc(r.courier)}</strong><small>${num(r.delivered)} delivered · ${num(r.assigned)} assigned · ${num(r.undelivered)} undelivered</small></div><span class="status-chip ${Number(r.assigned) ? 'info' : ''}">${Number(r.assigned) ? Math.round((Number(r.delivered || 0) / Number(r.assigned || 1)) * 100) : 0}%</span></div>`).join('')}</div>`;
  }
  function renderCourierTaskList(rows) {
    if (!rows.length) return emptyState('No assigned deliveries', 'A delivery run assigned to you will appear here.', '⌖');
    return `<div class="activity-list">${rows.slice(0, 5).map((r) => `<div class="activity-item"><span class="activity-dot"></span><div class="activity-copy"><strong>${esc(r.awb)} · ${esc(r.receiver_name)}</strong><small>${esc(r.receiver_city)} · ${esc(prettyStatus(r.status))}</small></div>${chip(r.status)}</div>`).join('')}</div>`;
  }

  async function renderBookings() {
    if (state.user.role !== 'ADMIN') throw new Error('Booking management is available to admin staff only.');
    const result = await Api.get('/shipments');
    const shipments = result.shipments || [];
    const rows = shipments.slice(0, 30).map((s) => `<tr><td>${cellPrimary(s.awb, s.package_type || 'Parcel')}</td><td>${cellPrimary(s.sender_name, s.sender_city)}</td><td>${cellPrimary(s.receiver_name, s.receiver_city)}</td><td>${chip(s.status)}</td><td>${esc(dateLabel(s.created_at))}</td><td>${btn('Book again', 'book-again', 'btn-small btn-outline', `data-id="${esc(s.id)}"`)}</td></tr>`).join('');
    return { data: { shipments }, html: `${heading('Booking new / old', 'Create a fresh shipment or reuse the sender and receiver details from a previous booking.', btn('＋ Booking new', 'new-booking', 'btn-primary'))}<div class="dashboard-grid"><section class="panel"><div class="panel-body"><div class="kpi-icon" style="margin-bottom:14px">＋</div><div class="panel-title">Booking new</div><p class="panel-subtitle" style="line-height:1.7;margin-bottom:16px">Enter sender, receiver, package and payment details. A unique AWB is generated when you save.</p>${btn('Create booking →', 'new-booking', 'btn-primary')}</div></section><section class="panel"><div class="panel-body"><div class="kpi-icon" style="margin-bottom:14px">↻</div><div class="panel-title">Booking old</div><p class="panel-subtitle" style="line-height:1.7;margin-bottom:16px">Select a previous shipment to prefill the booking form; a new AWB and new shipment record are generated.</p>${btn('Reuse a previous booking ↓', 'scroll-booking-history', 'btn-outline')}</div></section></div><section class="table-panel" id="booking-history"><div class="panel-header"><div><div class="panel-title">Previous bookings</div><div class="panel-subtitle">Latest records that can be reused as a template</div></div><span class="toolbar-total">${shipments.length} recent records</span></div>${rows ? `<div class="table-scroll"><table><thead><tr><th>AWB</th><th>Sender</th><th>Receiver</th><th>Status</th><th>Booked date</th><th></th></tr></thead><tbody>${rows}</tbody></table></div>` : emptyState('No previous bookings', 'Create a new shipment first to build your reusable booking history.', '▤')}</section>` };
  }

  async function renderDeliveryEntry() {
    if (!['ADMIN', 'COURIER'].includes(state.user.role)) throw new Error('Delivery entry is available to operations staff and assigned couriers.');
    return { data: { shipments: [] }, html: `${heading('Delivery entry', 'Search by AWB, verify the parcel and record the next valid delivery state.')}<section class="panel" style="max-width:900px"><div class="panel-header"><div><div class="panel-title">Shipment lookup</div><div class="panel-subtitle">Status updates are validated against shipment lifecycle rules.</div></div></div><div class="panel-body"><form class="form-stack" data-form="delivery-entry-lookup"><div class="field"><label for="delivery-awb">AWB number</label><input class="input" id="delivery-awb" name="awb" required placeholder="Scan or enter AWB number"></div><div><button class="btn btn-primary" type="submit">Search shipment →</button></div></form></div></section><div id="delivery-entry-result" style="margin-top:18px"></div>` };
  }

  async function renderShipments() {
    const query = new URLSearchParams();
    if (state.search) query.set('search', state.search);
    if (state.statusFilter) query.set('status', state.statusFilter);
    const result = await Api.get(`/shipments?${query.toString()}`);
    const rows = result.shipments || [];
    const isAdmin = state.user.role === 'ADMIN';
    const isCourier = state.user.role === 'COURIER';
    const actions = `${isAdmin ? btn('＋ New booking', 'new-booking', 'btn-primary') : ''}${isCourier ? btn('Refresh route', 'retry-page', 'btn-outline') : ''}`;
    const tableRows = rows.map((s) => `<tr><td>${cellPrimary(s.awb, s.package_type || 'Parcel')}</td><td>${cellPrimary(s.receiver_name, s.receiver_phone)}</td><td>${cellPrimary(s.receiver_city, s.receiver_pincode)}</td><td>${chip(s.status)}</td><td>${cellPrimary(s.courier_name || 'Unassigned', s.courier_phone || '')}</td><td>${esc(dateLabel(s.created_at))}</td><td><div class="table-actions">${btn('View', 'view-shipment', 'btn-small btn-outline', `data-id="${esc(s.id)}"`)}${isAdmin ? btn('Assign', 'assign-shipment', 'btn-small btn-outline', `data-id="${esc(s.id)}"`) + btn('Status', 'update-status', 'btn-small btn-outline', `data-id="${esc(s.id)}"`) : ''}${isCourier && ['PICKUP_ASSIGNED','AT_DESTINATION_HUB','UNDELIVERED'].includes(s.status) ? btn('Start', 'start-delivery', 'btn-small btn-primary', `data-id="${esc(s.id)}"`) : ''}${isCourier && s.status === 'OUT_FOR_DELIVERY' ? btn('Share GPS', 'share-location', 'btn-small btn-primary', `data-id="${esc(s.id)}"`) : ''}${(isAdmin || (isCourier && s.courier_user_id === state.user.id)) && s.status === 'OUT_FOR_DELIVERY' ? btn('POD', 'capture-pod', 'btn-small btn-outline', `data-id="${esc(s.id)}"`) : ''}</div></td></tr>`).join('');
    return { data: { shipments: rows }, html: `${heading(isAdmin ? 'Shipment management' : isCourier ? 'Assigned deliveries' : 'My shipments', isAdmin ? 'Search and maintain every parcel across your operation.' : isCourier ? 'Your assigned shipments and delivery actions.' : 'Track your own shipments and review the latest status.', actions)}<section class="table-panel"><div class="table-toolbar"><div class="table-filters"><input class="input" id="shipment-search" placeholder="Search AWB, receiver, phone…" value="${esc(state.search)}"><select class="select" id="shipment-status"><option value="">All statuses</option>${SHIP_STATUS.map((st) => `<option value="${st}" ${state.statusFilter === st ? 'selected' : ''}>${esc(prettyStatus(st))}</option>`).join('')}</select><button class="btn btn-outline btn-small" data-action="filter-shipments">Apply filters</button></div><span class="toolbar-total">${rows.length} shipment${rows.length === 1 ? '' : 's'}</span></div>${rows.length ? `<div class="table-scroll"><table><thead><tr><th>AWB / type</th><th>Receiver</th><th>Destination</th><th>Status</th><th>Courier</th><th>Booked</th><th style="text-align:right">Actions</th></tr></thead><tbody>${tableRows}</tbody></table></div>` : emptyState('No shipments found', state.search || state.statusFilter ? 'Try changing the search or status filter.' : 'Create a booking to start managing shipments.', '▤', isAdmin ? btn('＋ Create booking', 'new-booking', 'btn-primary') : '')}</section><div class="footer-note">AWB records are indexed and shipment access is restricted by role.</div>` };
  }

  async function renderLiveOperations() {
    if (state.user.role !== 'ADMIN') throw new Error('This page is only available to operations staff.');
    const [locResult, shipResult] = await Promise.all([Api.get('/tracking/live'), Api.get('/shipments?status=OUT_FOR_DELIVERY')]);
    state.liveLocations = locResult.locations || [];
    const locations = state.liveLocations;
    const activeShips = shipResult.shipments || [];
    const locationCards = activeShips.map((s) => {
      const point = locations.find((l) => l.shipment_id === s.id);
      return `<div class="location-card" data-location-card="${esc(s.id)}"><div class="location-card-top"><div><strong>${esc(s.receiver_name)} · ${esc(s.awb)}</strong><p>${esc(s.receiver_city)} · ${esc(s.courier_name || 'Unassigned courier')}</p></div>${chip(s.status)}</div><div class="location-meta"><span>${point ? `Updated ${esc(dateLabel(point.updated_at, true))}` : 'No location yet'}</span><span>${point ? `${Number(point.latitude).toFixed(4)}, ${Number(point.longitude).toFixed(4)}` : 'Location unavailable'}</span></div><div style="display:flex;gap:7px;margin-top:11px">${btn('Simulate route', 'simulate-route', 'btn-small btn-primary', `data-id="${esc(s.id)}"`)}${btn('View shipment', 'view-shipment', 'btn-small btn-outline', `data-id="${esc(s.id)}"`)}</div></div>`;
    }).join('');
    return { data: { locations, activeShips }, html: `${heading('Live operations', 'Monitor active courier activity, location freshness and delivery exceptions.', btn('Refresh locations', 'retry-page', 'btn-outline'))}<div class="kpi-grid">${kpi('ACTIVE DELIVERIES', num(activeShips.length), '⌖', 'Out for delivery')}${kpi('COURIER LOCATIONS', num(locations.length), '◉', 'Last known points')}${kpi('LOCATION STALE', num(locations.filter((l) => Date.now() - new Date(l.updated_at.replace(' ', 'T') + 'Z').getTime() > 120000).length), '◷', 'Older than 2 minutes')}${kpi('COURIERS ONLINE', num(new Set(locations.map((l) => l.courier_user_id)).size), '♟', 'With recent tracking')}</div><div class="dashboard-grid" style="grid-template-columns:minmax(0,1.55fr) minmax(290px,.8fr)"><section class="panel"><div class="panel-header"><div><div class="panel-title">Courier live map</div><div class="panel-subtitle">GPS and demo route points · OpenStreetMap</div></div><span class="status-chip good">Live</span></div><div class="panel-body"><div class="map-frame tall" id="live-map"></div><div class="map-legend" style="margin-top:13px"><span class="legend-item"><span class="legend-dot"></span> Courier location</span><span class="legend-item"><span class="legend-dot green"></span> Shipment destination</span></div></div></section><section class="panel"><div class="panel-header"><div><div class="panel-title">Active delivery sessions</div><div class="panel-subtitle">Select a shipment to simulate a route for SIH demo</div></div></div><div class="panel-body">${locationCards || emptyState('No active deliveries', 'Shipments marked Out for Delivery will appear here.', '⌖', btn('View shipments', 'navigate', 'btn-outline', 'data-page="shipments"'))}<div class="field-help" style="margin-top:14px">Demo route points are synthetic and only available while DEMO_MODE is enabled.</div></div></section></div>` };
  }

  async function renderDrs() {
    const { drs = [] } = await Api.get('/drs');
    const isAdmin = state.user.role === 'ADMIN';
    const rows = drs.map((d) => `<tr><td>${cellPrimary(d.drs_number)}</td><td>${esc(dateLabel(d.scheduled_date))}</td><td>${cellPrimary(d.courier_name)}</td><td>${num(d.shipment_count)}</td><td>${chip(d.status)}</td><td>${esc(dateLabel(d.created_at, true))}</td><td>${btn('Details', 'view-drs', 'btn-small btn-outline', `data-id="${esc(d.id)}"`)}</td></tr>`).join('');
    return { data: { drs }, html: `${heading('Delivery run sheets', 'Group assigned parcels by courier and planned delivery date.', isAdmin ? btn('＋ Generate DRS', 'generate-drs', 'btn-primary') : '')}<section class="table-panel">${rows ? `<div class="table-scroll"><table><thead><tr><th>DRS number</th><th>Planned date</th><th>Courier</th><th>Shipments</th><th>Status</th><th>Created</th><th></th></tr></thead><tbody>${rows}</tbody></table></div>` : emptyState('No delivery runs yet', isAdmin ? 'Generate a delivery run sheet to assign shipments to a courier.' : 'Delivery run sheets assigned to you will appear here.', '▤', isAdmin ? btn('＋ Generate DRS', 'generate-drs', 'btn-primary') : '')}</section>` };
  }

  async function renderPickups() {
    const { pickups = [] } = await Api.get('/pickups');
    const isAdmin = state.user.role === 'ADMIN';
    const canCreate = ['ADMIN', 'CUSTOMER'].includes(state.user.role);
    const rows = pickups.map((p) => `<tr><td>${cellPrimary(p.pickup_number)}</td><td>${cellPrimary(p.customer_name, p.customer_phone)}</td><td>${cellPrimary(p.address, `${p.city} · ${p.pincode}`)}</td><td>${esc(dateLabel(p.requested_date))}</td><td>${cellPrimary(p.courier_name || 'Unassigned')}</td><td>${chip(p.status)}</td><td><div class="table-actions">${isAdmin ? btn('Assign', 'assign-pickup', 'btn-small btn-outline', `data-id="${esc(p.id)}"`) : ''}${['ADMIN','COURIER'].includes(state.user.role) && !['COMPLETED','CANCELLED'].includes(p.status) ? btn('Update', 'update-pickup', 'btn-small btn-outline', `data-id="${esc(p.id)}" data-status="${esc(p.status)}"`) : ''}</div></td></tr>`).join('');
    return { data: { pickups }, html: `${heading('Pickup management', 'Schedule parcel collections, assign an executive and follow pickup status.', canCreate ? btn('＋ New pickup', 'new-pickup', 'btn-primary') : '')}<section class="table-panel">${rows ? `<div class="table-scroll"><table><thead><tr><th>Pickup ID</th><th>Customer</th><th>Address</th><th>Date</th><th>Courier</th><th>Status</th><th></th></tr></thead><tbody>${rows}</tbody></table></div>` : emptyState('No pickup requests', 'Pickup requests will appear here as customers or staff create them.', '↙', canCreate ? btn('＋ New pickup', 'new-pickup', 'btn-primary') : '')}</section>` };
  }

  async function renderPod() {
    const [podResult, shipmentResult] = await Promise.all([Api.get('/pod'), Api.get('/shipments')]);
    const pods = podResult.pods || [];
    const needPod = (shipmentResult.shipments || []).filter((s) => s.status === 'OUT_FOR_DELIVERY' && (state.user.role === 'ADMIN' || s.courier_user_id === state.user.id));
    const rows = pods.map((p) => `<tr><td>${cellPrimary(p.awb)}</td><td>${cellPrimary(p.receiver_name)}</td><td>${esc(p.courier_name || '—')}</td><td>${esc(dateLabel(p.delivered_at, true))}</td><td>${esc(p.remarks || '—')}</td><td>${p.photo_filename ? `<a href="/api/pod/${esc(p.id)}/photo" target="_blank" rel="noopener" class="awb-text">View photo ↗</a>` : '<span class="cell-secondary">No photo</span>'}</td></tr>`).join('');
    return { data: { pods, needPod }, html: `${heading('Proof of delivery', 'Record receiver identity, optional photo, signature and delivery coordinates.', needPod.length ? `<span class="status-chip warning">${needPod.length} awaiting POD</span>` : '')}<section class="panel" style="margin-bottom:18px"><div class="panel-header"><div><div class="panel-title">Awaiting proof of delivery</div><div class="panel-subtitle">Only Out for Delivery shipments are eligible for POD capture.</div></div></div><div class="panel-body">${needPod.length ? `<div class="activity-list">${needPod.map((s) => `<div class="activity-item"><span class="activity-dot"></span><div class="activity-copy"><strong>${esc(s.awb)} · ${esc(s.receiver_name)}</strong><small>${esc(s.receiver_city)} · ${esc(s.receiver_phone)}</small></div>${btn('Capture POD', 'capture-pod', 'btn-small btn-primary', `data-id="${esc(s.id)}"`)}</div>`).join('')}</div>` : emptyState('No deliveries awaiting POD', 'When a courier starts a delivery, it becomes eligible for proof-of-delivery capture.', '▣')}</div></section><section class="table-panel"><div class="panel-header"><div><div class="panel-title">Completed POD records</div><div class="panel-subtitle">Securely stored delivery confirmations</div></div></div>${rows ? `<div class="table-scroll"><table><thead><tr><th>AWB</th><th>Receiver</th><th>Courier</th><th>Delivered</th><th>Remarks</th><th>Attachment</th></tr></thead><tbody>${rows}</tbody></table></div>` : emptyState('No POD records', 'Proof of delivery records will appear here after a delivery is confirmed.', '▣')}</section>` };
  }

  async function renderCouriers() {
    const { couriers = [] } = await Api.get('/couriers');
    const rows = couriers.map((c) => `<tr><td>${cellPrimary(c.name, c.email)}</td><td>${esc(c.phone || '—')}</td><td><span class="status-chip ${c.active ? 'good' : 'danger'}">${c.active ? 'Active' : 'Inactive'}</span></td><td>${num(c.active_shipments)}</td><td>${esc(c.last_location_at ? dateLabel(c.last_location_at, true) : 'No location yet')}</td><td>${btn(c.active ? 'Deactivate' : 'Activate', 'toggle-courier', `btn-small ${c.active ? 'btn-outline' : 'btn-primary'}`, `data-id="${esc(c.id)}" data-active="${c.active ? '1' : '0'}"`)}</td></tr>`).join('');
    return { data: { couriers }, html: `${heading('Courier directory', 'Review authorized delivery accounts, workload and last location activity.', btn('↻ Refresh', 'retry-page', 'btn-outline'))}<section class="table-panel">${rows ? `<div class="table-scroll"><table><thead><tr><th>Courier</th><th>Phone</th><th>Account</th><th>Open shipments</th><th>Last location</th><th></th></tr></thead><tbody>${rows}</tbody></table></div>` : emptyState('No couriers found', 'Create courier accounts through the approved workplace onboarding process.', '♟')}</section><div class="alert info" style="margin-top:14px">This starter exposes activation controls for existing couriers. Secure courier provisioning should remain a workplace-admin task.</div>` };
  }

  async function renderCustomers() {
    const query = new URLSearchParams(); if (state.search) query.set('search', state.search);
    const { customers = [] } = await Api.get(`/customers?${query.toString()}`);
    const rows = customers.map((c) => `<tr><td>${cellPrimary(c.name, c.email || '')}</td><td>${esc(c.phone)}</td><td>${cellPrimary(c.city || '—', c.pincode || '')}</td><td>${num(c.shipment_count)}</td><td><span class="status-chip ${c.user_id ? (c.account_active ? 'good' : 'danger') : ''}">${c.user_id ? (c.account_active ? 'Portal account' : 'Inactive') : 'Contact only'}</span></td><td>${esc(dateLabel(c.created_at))}</td></tr>`).join('');
    return { data: { customers }, html: `${heading('Customer management', 'Customer identities are connected to shipments through verified phone accounts.', btn('↻ Refresh', 'retry-page', 'btn-outline'))}<section class="table-panel"><div class="table-toolbar"><div class="table-filters"><input class="input" id="customer-search" placeholder="Search name, phone or city…" value="${esc(state.search)}"><button class="btn btn-outline btn-small" data-action="filter-customers">Search</button></div><span class="toolbar-total">${customers.length} customers</span></div>${rows ? `<div class="table-scroll"><table><thead><tr><th>Customer</th><th>Phone</th><th>City / pincode</th><th>Shipments</th><th>Account</th><th>Added</th></tr></thead><tbody>${rows}</tbody></table></div>` : emptyState('No customer records', 'Customer profiles are created when a customer verifies a phone number or is linked during booking.', '♙')}</section>` };
  }

  async function renderReports() {
    const [dashboard, reports] = await Promise.all([Api.get('/reports/dashboard'), Api.get('/reports')]);
    const s = reports.summary || {};
    const trends = reports.trends || [];
    const rows = dashboard.admin?.courierPerformance || [];
    return { data: { dashboard, reports }, html: `${heading('Reports & analytics', 'Read operational performance using the shipment records stored in the database.', btn('Download shipment CSV', 'export-csv', 'btn-primary'))}<div class="report-stat-grid" style="margin-bottom:18px">${reportStat('Delivery success rate', `${s.deliverySuccessRate || 0}%`)}${reportStat('RTO rate', `${s.rtoRate || 0}%`)}${reportStat('Avg. delivery time', `${Number(s.avgHours || 0).toFixed(1)} hrs`)}</div><div class="dashboard-grid"><section class="panel"><div class="panel-header"><div><div class="panel-title">Bookings vs deliveries</div><div class="panel-subtitle">Activity by booking date</div></div></div><div class="panel-body">${renderMiniChart(trends)}</div></section><section class="panel"><div class="panel-header"><div><div class="panel-title">Status distribution</div><div class="panel-subtitle">All shipments in the current database</div></div></div><div class="panel-body">${renderStatusBars(reports.statuses || [])}</div></section></div><section class="table-panel"><div class="panel-header"><div><div class="panel-title">Courier performance</div><div class="panel-subtitle">Shipment allocation and close-out count</div></div></div>${rows.length ? `<div class="table-scroll"><table><thead><tr><th>Courier</th><th>Assigned</th><th>Delivered</th><th>Undelivered</th><th>Completion</th></tr></thead><tbody>${rows.map((r) => `<tr><td>${cellPrimary(r.courier)}</td><td>${num(r.assigned)}</td><td>${num(r.delivered)}</td><td>${num(r.undelivered)}</td><td>${Math.round(Number(r.delivered || 0) / Math.max(1, Number(r.assigned || 0)) * 100)}%</td></tr>`).join('')}</tbody></table></div>` : emptyState('No courier metrics yet', 'Courier assignments will populate this report.', '◔')}</section>` };
  }
  function reportStat(label, value) { return `<div class="report-stat"><small>${esc(label)}</small><strong>${esc(value)}</strong></div>`; }

  async function renderFinance() {
    const { entries = [], totals = {} } = await Api.get('/finance');
    const rows = entries.map((e) => `<tr><td>${cellPrimary(e.category, e.reference)}</td><td><span class="status-chip ${e.kind === 'INCOME' ? 'good' : 'danger'}">${esc(e.kind)}</span></td><td class="${e.kind === 'INCOME' ? 'money-positive' : 'money-negative'}">${e.kind === 'INCOME' ? '+' : '−'}${esc(money(e.amount))}</td><td>${esc(e.description || '—')}</td><td>${esc(dateLabel(e.entry_date))}</td><td>${esc(e.created_by_name || '—')}</td><td>${btn('Delete', 'delete-finance', 'btn-small btn-outline', `data-id="${esc(e.id)}"`)}</td></tr>`).join('');
    return { data: { entries, totals }, html: `${heading('Digital accounts', 'Maintain categorized income and expense records for the courier operation.', btn('＋ Add entry', 'new-finance', 'btn-primary'))}<div class="kpi-grid">${kpi('TOTAL INCOME', money(totals.income), '↗', 'Records in selected ledger')}${kpi('TOTAL EXPENSES', money(totals.expenses), '↘', 'Operational costs')}${kpi('NET BALANCE', money(totals.net), '₹', 'Income minus expenses')}${kpi('ENTRIES', num(totals.entries), '▤', 'Ledger records')}</div><section class="table-panel">${rows ? `<div class="table-scroll"><table><thead><tr><th>Category / reference</th><th>Type</th><th>Amount</th><th>Description</th><th>Date</th><th>Created by</th><th></th></tr></thead><tbody>${rows}</tbody></table></div>` : emptyState('No financial records', 'Add an income or expense entry to begin the ledger.', '₹', btn('＋ Add entry', 'new-finance', 'btn-primary'))}</section><div class="alert warning" style="margin-top:14px">Financial entries are operational records, not a regulated accounting or payment-processing ledger. Validate reconciliation and audit policies before using this in production.</div>` };
  }

  async function renderSync() {
    const result = await Api.get('/sync');
    const items = result.items || [];
    const summary = Object.fromEntries((result.summary || []).map((x) => [x.state, x.count]));
    const rows = items.map((i) => `<tr><td>${cellPrimary(`${i.entity_type} · ${i.entity_id.slice(0, 12)}`)}</td><td>${esc(i.action)}</td><td>${chip(i.state)}</td><td>${num(i.attempts)}</td><td>${esc(dateLabel(i.updated_at, true))}</td><td>${i.state !== 'SYNCED' && state.user.role === 'ADMIN' ? btn('Retry', 'retry-sync', 'btn-small btn-outline', `data-id="${i.id}"`) : '—'}</td></tr>`).join('');
    return { data: result, html: `${heading('Sync centre', 'Review synchronization records written by the active backend.', btn('↻ Refresh', 'retry-page', 'btn-outline'))}<div class="kpi-grid">${kpi('PENDING', num(summary.PENDING), '◷', 'Awaiting retry')}${kpi('SYNCED', num(summary.SYNCED), '✓', 'Persisted in local database')}${kpi('FAILED', num(summary.FAILED), '!', 'Requires investigation')}${kpi('LAST SYNC', result.lastSync ? dateLabel(result.lastSync, true) : '—', '↻', 'Latest confirmed record')}</div><div class="alert info">Current mode: <strong>${esc(result.mode)}</strong>. The SQLite backend is authoritative in this starter. This is a sync activity ledger, not a complete offline-first mobile outbox.</div><section class="table-panel">${rows ? `<div class="table-scroll"><table><thead><tr><th>Record</th><th>Action</th><th>State</th><th>Attempts</th><th>Updated</th><th></th></tr></thead><tbody>${rows}</tbody></table></div>` : emptyState('No sync records', 'Create or update a shipment to generate sync activity.', '↻')}</section>` };
  }

  async function renderAudit() {
    const { logs = [] } = await Api.get('/audit');
    const rows = logs.map((l) => `<tr><td>${esc(dateLabel(l.created_at, true))}</td><td>${cellPrimary(l.actor_name || 'System', l.actor_role)}</td><td>${esc(l.action)}</td><td>${cellPrimary(l.entity_type, l.entity_id)}</td><td>${l.new_value ? `<button class="btn btn-small btn-outline" data-action="show-audit-detail" data-value="${esc(l.new_value)}">View data</button>` : '—'}</td></tr>`).join('');
    return { data: { logs }, html: `${heading('Audit logs', 'Review who changed what and when across important operational actions.', btn('↻ Refresh', 'retry-page', 'btn-outline'))}<section class="table-panel">${rows ? `<div class="table-scroll"><table><thead><tr><th>Timestamp</th><th>Actor</th><th>Action</th><th>Entity</th><th>Details</th></tr></thead><tbody>${rows}</tbody></table></div>` : emptyState('No audit events', 'Important actions will be recorded here.', '≋')}</section>` };
  }

  async function renderNotifications() {
    const { notifications = [] } = await Api.get('/notifications');
    const rows = notifications.map((n) => `<div class="activity-item"><span class="activity-dot" style="background:${n.read_at ? '#c4cedb' : '#655cff'}"></span><div class="activity-copy"><strong>${esc(n.title)}</strong><small>${esc(n.message)}</small><small>${esc(dateLabel(n.created_at, true))} · ${esc(n.kind)}</small></div>${n.read_at ? '<span class="status-chip">Read</span>' : btn('Mark read', 'mark-notification', 'btn-small btn-outline', `data-id="${esc(n.id)}"`)}</div>`).join('');
    return { data: { notifications }, html: `${heading('Notifications', 'Shipment updates, assignments and operational alerts.', btn('↻ Refresh', 'retry-page', 'btn-outline'))}<section class="panel"><div class="panel-body">${rows ? `<div class="activity-list">${rows}</div>` : emptyState('All quiet for now', 'Notifications will appear here when a shipment changes, a route is assigned or a delivery is completed.', '♢')}</div></section>` };
  }

  async function renderTrack() {
    return { data: {}, html: `${heading('Track shipment', 'Secure tracking details are available for shipments linked to your account.')}<section class="panel" style="max-width:950px"><div class="panel-header"><div><div class="panel-title">Find your parcel</div><div class="panel-subtitle">Enter the AWB shown on your booking confirmation</div></div></div><div class="panel-body"><form class="form-stack" data-form="track-awb"><div class="field"><label for="track-awb">Air Waybill (AWB) number</label><input class="input" id="track-awb" name="awb" placeholder="e.g. PP2610010001" required autocomplete="off"></div><div><button class="btn btn-primary" type="submit">Track shipment →</button></div></form><div class="field-help" style="margin-top:12px">For privacy, an AWB is not enough to reveal a customer's shipment or an unrelated courier's precise location. Sign in using the phone number linked to the shipment.</div></div></section><div id="tracking-result" style="margin-top:18px"></div>` };
  }
  function renderProfile() {
    return Promise.resolve({ data: {}, html: `${heading('My profile', 'Your signed-in account and permission scope.')}<section class="panel" style="max-width:750px"><div class="panel-header"><div><div class="panel-title">Account information</div><div class="panel-subtitle">Role is resolved from the server-side user record</div></div>${chip(state.user.role)}</div><div class="panel-body"><div class="shipment-detail-grid"><div class="detail-box"><small>Full name</small><strong>${esc(state.user.name)}</strong></div><div class="detail-box"><small>Role</small><strong>${esc(roleLabel(state.user.role))}</strong></div><div class="detail-box"><small>Email</small><strong>${esc(state.user.email || 'Not provided')}</strong></div><div class="detail-box"><small>Mobile</small><strong>${esc(state.user.phone || 'Not provided')}</strong></div></div><div class="alert info" style="margin-top:16px">Your role cannot be changed from this screen. Ask an authorized workplace administrator to update access through the approved account-provisioning process.</div><button class="btn btn-outline" data-action="logout" style="margin-top:10px">Sign out</button></div></section>` });
  }

  function mountPage(page, data) {
    Object.values(state.maps).forEach((entry) => { try { entry.map.remove(); } catch {} });
    state.maps = {};
    if (page === 'dashboard' && state.user.role === 'ADMIN') {
      Api.get('/tracking/live').then((r) => { state.liveLocations = r.locations || []; initMap('dashboard-map', state.liveLocations, false); }).catch(() => initMap('dashboard-map', [], false));
    }
    if (page === 'live') initMap('live-map', data.locations || [], true);
    if (page === 'track' && state.activeTracking) renderTrackingDetails(state.activeTracking);
  }

  function initMap(elementId, points, fitPoints = false) {
    const el = document.getElementById(elementId);
    if (!el || !window.L) return;

    if (state.maps[elementId]) {
      try {
        state.maps[elementId].map.remove();
      } catch {}
      delete state.maps[elementId];
    }

    el.querySelector('.map-placeholder')?.remove();

    try {
      const map = window.L
        .map(el, {
          zoomControl: true,
          scrollWheelZoom: false
        })
        .setView([13.0827, 80.2707], 11);

      const streetLayer = window.L.tileLayer(
        'https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}',
        {
          maxZoom: 19,
          attribution: 'Tiles &copy; Esri, HERE, Garmin, FAO, NOAA, USGS, EPA, NPS',
          keepBuffer: 2
        }
      );

      const satelliteLayer = window.L.tileLayer(
        'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
        {
          maxZoom: 19,
          attribution:
            'Tiles &copy; Esri, Maxar, Earthstar Geographics, and the GIS User Community',
          keepBuffer: 2
        }
      );

      const placeLabels = window.L.tileLayer(
        'https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}',
        {
          maxZoom: 19,
          attribution: 'Labels &copy; Esri',
          keepBuffer: 2
        }
      );

      const showTileError = () => {
        if (el.querySelector('.map-provider-notice')) return;
        const notice = document.createElement('div');
        notice.className = 'map-provider-notice';
        notice.textContent =
          'Map tiles could not be loaded. Check your internet connection. Courier location markers may still appear.';
        el.appendChild(notice);
      };

      const monitorBaseLayer = (layer) => {
        let tileErrors = 0;
        layer.on('tileerror', () => {
          tileErrors += 1;
          if (tileErrors >= 3 && map.hasLayer(layer)) showTileError();
        });
      };

      monitorBaseLayer(streetLayer);
      monitorBaseLayer(satelliteLayer);

      // Satellite imagery and place labels are enabled by default.
      satelliteLayer.addTo(map);
      placeLabels.addTo(map);

      window.L.control.layers(
        {
          Satellite: satelliteLayer,
          Street: streetLayer
        },
        {
          'Place labels': placeLabels
        },
        {
          collapsed: false
        }
      ).addTo(map);

      const markerLayer = window.L.layerGroup().addTo(map);
      const markers = new Map();

      (points || []).forEach((point) => {
        const lat = Number(point.latitude);
        const lng = Number(point.longitude);
        if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;

        const key =
          point.shipment_id ||
          point.shipmentId ||
          point.id ||
          `${lat}:${lng}`;

        const marker = window.L.marker([lat, lng]).addTo(markerLayer);
        marker.bindPopup(
          `<strong>${esc(
            point.awb ||
              point.shipment_awb ||
              point.courier_name ||
              point.courierName ||
              'Courier'
          )}</strong><br>${esc(
            point.courier_name || point.courierName || 'Live location'
          )}<br><small>${esc(
            point.source || 'GPS'
          )} &middot; ${esc(
            dateLabel(point.updated_at || point.updatedAt, true)
          )}</small>`
        );
        markers.set(key, marker);
      });

      const coords = [...markers.values()].map((marker) => marker.getLatLng());
      if (fitPoints && coords.length > 1) {
        map.fitBounds(window.L.latLngBounds(coords).pad(0.2));
      } else if (coords.length === 1) {
        map.setView(coords[0], 14);
      }

      state.maps[elementId] = { map, markerLayer, markers };
      setTimeout(() => map.invalidateSize(), 40);

      if (!coords.length) {
        const notice = document.createElement('div');
        notice.className = 'map-placeholder';
        notice.innerHTML =
          'No live location yet<br><small>Location appears after a courier starts sharing GPS.</small>';
        el.appendChild(notice);
      }
    } catch (err) {
      console.warn('Map could not initialize:', err.message);
      el.innerHTML =
        '<div class="map-placeholder">Map tiles are unavailable. Live location data can still be viewed from the shipment details.</div>';
    }
  }
  function refreshLivePoint(point) {
    const index = state.liveLocations.findIndex((l) => l.shipment_id === point.shipmentId);
    const next = { ...point, shipment_id: point.shipmentId, courier_user_id: point.courierId, updated_at: point.updated_at || point.updatedAt || new Date().toISOString() };
    if (index >= 0) state.liveLocations.splice(index, 1, { ...state.liveLocations[index], ...next });
    else state.liveLocations.push(next);
    for (const mapId of ['live-map', 'dashboard-map']) {
      const existing = state.maps[mapId];
      if (existing && window.L) {
        document.querySelector(`#${mapId} .map-placeholder`)?.remove();
        const key = next.shipment_id;
        let marker = existing.markers.get(key);
        if (!marker) {
          marker = window.L.marker([Number(next.latitude), Number(next.longitude)]).addTo(existing.markerLayer);
          existing.markers.set(key, marker);
        } else marker.setLatLng([Number(next.latitude), Number(next.longitude)]);
        marker.bindPopup(`<strong>${esc(next.awb || 'Active shipment')}</strong><br>${esc(next.courier_name || next.courierName || 'Courier')}<br><small>Updated just now</small>`);
        if (mapId === 'live-map') existing.map.panTo([Number(next.latitude), Number(next.longitude)], { animate: true, duration: .5 });
      }
    }
    const card = document.querySelector(`[data-location-card="${CSS.escape(point.shipmentId)}"]`);
    const meta = card?.querySelector('.location-meta');
    if (meta) meta.innerHTML = `<span>Updated just now</span><span>${Number(point.latitude).toFixed(4)}, ${Number(point.longitude).toFixed(4)}</span>`;
  }

  function stopLocationWatch() {
    if (state.locationWatchId != null && navigator.geolocation) {
      navigator.geolocation.clearWatch(state.locationWatchId);
    }
    state.locationWatchId = null;
    state.lastLocationSentAt = 0;
    state.lastLocationCoords = null;
  }
  function startLocationWatch(shipmentId) {
    if (!navigator.geolocation) return toast('This browser does not support location sharing.', 'error');
    stopLocationWatch();
    toast('Requesting device location permission…');
    state.locationWatchId = navigator.geolocation.watchPosition(async (position) => {
      const now = Date.now();
      const coords = position.coords;
      const last = state.lastLocationCoords;
      const moved = !last || Math.hypot((coords.latitude - last.lat) * 111000, (coords.longitude - last.lng) * 85000) >= 25;
      if (!moved && now - state.lastLocationSentAt < 15000) return;
      try {
        await Api.post(`/tracking/${encodeURIComponent(shipmentId)}/location`, {
          latitude: coords.latitude, longitude: coords.longitude, accuracy: coords.accuracy
        });
        state.lastLocationSentAt = now;
        state.lastLocationCoords = { lat: coords.latitude, lng: coords.longitude };
      } catch (err) {
        stopLocationWatch();
        showError(err);
      }
    }, (error) => {
      stopLocationWatch();
      const message = error.code === 1 ? 'Location permission is required to share your live delivery position.' : error.code === 2 ? 'Current location is unavailable. Check GPS settings.' : 'Could not get a location fix. Please retry.';
      toast(message, 'error');
    }, { enableHighAccuracy: true, maximumAge: 8000, timeout: 15000 });
    toast('Live location sharing started. Updates are sent when movement or time thresholds are met.', 'success');
  }

  async function trackAwb(awb, showToast = false) {
    const target = $('#tracking-result');
    if (target) target.innerHTML = `<div class="panel"><div class="panel-body">${emptyState('Looking up shipment', 'Loading the latest authorized tracking details…', '⌕')}</div></div>`;
    try {
      const result = await Api.get(`/shipments/track/${encodeURIComponent(String(awb).trim())}`);
      state.activeTracking = result;
      const container = $('#tracking-result');
      if (container) renderTrackingDetails(result);
      if (state.socket) state.socket.emit('join-shipment', result.shipment.id, () => {});
      if (showToast) toast('Shipment found.', 'success');
    } catch (err) {
      state.activeTracking = null;
      if ($('#tracking-result')) $('#tracking-result').innerHTML = `<div class="panel"><div class="panel-body">${emptyState('Shipment not found or not linked', errorMessage(err), '⌕')}</div></div>`;
      else toast(errorMessage(err), 'error');
    }
  }

  function renderTrackingDetails(result) {
    const target = $('#tracking-result');
    if (!target) return;
    const s = result.shipment;
    const loc = result.location;
    const events = result.events || [];
    const showLocation = s.status === 'OUT_FOR_DELIVERY' && loc;
    const chronology = events.map((e, i) => `<div class="timeline-item ${i < events.length - 1 ? 'done' : 'current'}"><span class="timeline-node"></span><strong>${esc(prettyStatus(e.status))}</strong><small>${esc(e.location || e.remarks || 'Shipment update')} · ${esc(dateLabel(e.created_at, true))}</small></div>`).join('');
    target.innerHTML = `<div class="dashboard-grid" style="grid-template-columns:minmax(0,1.15fr) minmax(290px,.85fr)"><section class="panel"><div class="panel-header"><div><div class="panel-title">Shipment ${esc(s.awb)}</div><div class="panel-subtitle">Booked ${esc(dateLabel(s.created_at))} · ${esc(s.service_type || 'Standard')} service</div></div>${chip(s.status)}</div><div class="panel-body"><div class="shipment-detail-grid"><div class="detail-box"><small>Origin</small><strong>${esc(s.sender_city || '—')}<br><span style="color:#7d8da2;font-weight:500">${esc(s.sender_name || '')}</span></strong></div><div class="detail-box"><small>Destination</small><strong>${esc(s.receiver_city || '—')}<br><span style="color:#7d8da2;font-weight:500">${esc(s.receiver_name || '')}</span></strong></div><div class="detail-box"><small>Package</small><strong>${esc(s.package_type || 'Parcel')} · ${esc(s.weight_kg)} kg</strong></div><div class="detail-box"><small>Estimated delivery</small><strong>${esc(s.status === 'DELIVERED' ? dateLabel(s.delivered_at, true) : 'Provided by service operations')}</strong></div></div><div class="panel-title" style="margin-top:24px;margin-bottom:16px">Shipment timeline</div><div class="timeline">${chronology || '<div class="field-help">No tracking events have been recorded yet.</div>'}</div>${result.pod ? `<div class="alert info" style="margin-top:18px"><strong>Proof of delivery captured</strong><br>Received by ${esc(result.pod.receiver_name)} · ${esc(dateLabel(result.pod.delivered_at, true))}${result.pod.remarks ? `<br>${esc(result.pod.remarks)}` : ''}${result.pod.photoUrl ? `<br><a class=\"awb-text\" href=\"${esc(result.pod.photoUrl)}\" target=\"_blank\" rel=\"noopener\">View proof photo ↗</a>` : ''}</div>` : ''}</div></section><section class="panel"><div class="panel-header"><div><div class="panel-title">Live courier tracking</div><div class="panel-subtitle">Only visible for your authorized, active shipment</div></div>${showLocation ? '<span class="status-chip good">LIVE</span>' : '<span class="status-chip">' + (s.status === 'OUT_FOR_DELIVERY' ? 'No location' : 'Not active') + '</span>'}</div><div class="panel-body"><div class="map-frame" id="tracking-map"></div><div style="display:flex;justify-content:space-between;gap:12px;margin-top:13px"><div><div class="cell-primary">${esc(s.courier_name || 'Courier not assigned')}</div><div class="cell-secondary">${showLocation ? `Location updated ${esc(dateLabel(loc.updated_at, true))}` : s.status === 'OUT_FOR_DELIVERY' ? 'Waiting for courier GPS' : 'Live GPS starts when the courier begins delivery'}</div></div><div style="text-align:right"><div class="cell-primary">${showLocation ? `${Number(loc.accuracy_m || 0).toFixed(0)} m` : '—'}</div><div class="cell-secondary">GPS accuracy</div></div></div>${showLocation ? `<div class="alert info" style="margin-top:14px">Last position: ${Number(loc.latitude).toFixed(5)}, ${Number(loc.longitude).toFixed(5)} · ${esc(loc.source || 'GPS')}</div>` : `<div class="field-help" style="margin-top:12px">ETA and route distance require a routing provider configuration. The current build displays last-known position when a location update is available.</div>`}</div></section></div>`;
    if (showLocation) initMap('tracking-map', [{ ...loc, awb: s.awb, courier_name: s.courier_name }], false);
    else initMap('tracking-map', [], false);
  }
  function updateTrackingLocation(point) {
    if (!state.activeTracking || state.activeTracking.shipment.id !== point.shipmentId) return;
    state.activeTracking.location = point;
    renderTrackingDetails(state.activeTracking);
    if (state.socket) state.socket.emit('join-shipment', point.shipmentId, () => {});
  }

  function openModal(title, subtitle, content, wide = false) {
    closeModal();
    const div = document.createElement('div');
    div.className = 'modal-backdrop';
    div.id = 'active-modal';
    div.innerHTML = `<section class="modal ${wide ? 'wide' : ''}" role="dialog" aria-modal="true" aria-label="${esc(title)}"><header class="modal-header"><div><h2>${esc(title)}</h2><p>${esc(subtitle || '')}</p></div><button class="modal-close" type="button" data-action="close-modal" aria-label="Close dialog">×</button></header><div class="modal-content">${content}</div></section>`;
    document.body.appendChild(div);
    const first = $('input:not([type=hidden]),select,textarea,button', div);
    first?.focus({ preventScroll: true });
    div.addEventListener('mousedown', (event) => { if (event.target === div) closeModal(); });
  }
  function closeModal() { $('#active-modal')?.remove(); }
  function modalForm(formName, body, submitLabel = 'Save changes') {
    return `<form data-form="${esc(formName)}">${body}<div class="modal-footer"><button class="btn btn-outline" type="button" data-action="close-modal">Cancel</button><button class="btn btn-primary" type="submit">${esc(submitLabel)}</button></div></form>`;
  }
  function field(name, label, options = {}) {
    const type = options.type || 'text';
    const value = options.value ?? '';
    const placeholder = options.placeholder || '';
    const required = options.required ? 'required' : '';
    const step = options.step ? `step="${esc(options.step)}"` : '';
    if (type === 'textarea') return `<div class="field ${options.className || ''}"><label for="f-${esc(name)}">${esc(label)}</label><textarea class="textarea" id="f-${esc(name)}" name="${esc(name)}" placeholder="${esc(placeholder)}" ${required}>${esc(value)}</textarea></div>`;
    return `<div class="field ${options.className || ''}"><label for="f-${esc(name)}">${esc(label)}</label><input class="input" id="f-${esc(name)}" name="${esc(name)}" type="${esc(type)}" value="${esc(value)}" placeholder="${esc(placeholder)}" ${step} ${required} ${options.min ? `min="${esc(options.min)}"` : ''} ${options.max ? `max="${esc(options.max)}"` : ''}></div>`;
  }

  async function newBookingModal(seed = null) {
    if (state.user.role !== 'ADMIN') return toast('Only admin staff can create bookings.', 'error');
    const content = modalForm('new-booking', `<div class="two-col-form"><div class="form-section">Sender details</div>${field('senderName','Sender name',{required:true})}${field('senderPhone','Sender phone',{required:true,type:'tel'})}${field('senderAddress','Sender address',{required:true})}${field('senderCity','Sender city',{required:true})}${field('senderPincode','Sender pincode',{required:true})}<div class="form-section">Receiver details</div>${field('receiverName','Receiver name',{required:true})}${field('receiverPhone','Receiver phone',{required:true,type:'tel'})}${field('receiverAddress','Receiver address',{required:true})}${field('receiverCity','Receiver city',{required:true})}${field('receiverPincode','Receiver pincode',{required:true})}<div class="form-section">Parcel and billing</div><div class="field"><label for="f-packageType">Package type</label><select class="select" id="f-packageType" name="packageType"><option>Parcel</option><option>Document</option><option>Fragile</option><option>Perishable</option><option>Electronics</option></select></div>${field('weightKg','Weight (kg)',{type:'number',value:'1',required:true,step:'0.1',min:'0.1',max:'1000'})}${field('dimensions','Dimensions',{placeholder:'e.g. 30 x 20 x 10 cm'})}<div class="field"><label for="f-serviceType">Service type</label><select class="select" id="f-serviceType" name="serviceType"><option>Standard</option><option selected>Express</option><option>Same Day</option><option>Economy</option></select></div><div class="field"><label for="f-paymentMode">Payment mode</label><select class="select" id="f-paymentMode" name="paymentMode"><option>Prepaid</option><option>COD</option><option>Account</option></select></div>${field('amount','Shipping amount (₹)',{type:'number',value:'199',required:true,step:'0.01',min:'0'})}${field('customerPhone','Customer account phone (optional)',{type:'tel',placeholder:'Verified customer mobile'})}${field('originHub','Origin hub',{value:'Chennai Hub'})}${field('destinationHub','Destination hub',{value:'Chennai Hub'})}${field('specialInstructions','Special instructions',{type:'textarea',className:'span-2'})}</div>`, 'Create shipment');
    openModal('Create shipment booking', seed ? `Reuse details from ${seed.awb}; a new AWB will be generated.` : 'Create a parcel record and generate a unique Air Waybill number.', content, true);
    if (seed) {
      const values = { senderName: seed.sender_name, senderPhone: seed.sender_phone, senderAddress: seed.sender_address, senderCity: seed.sender_city, senderPincode: seed.sender_pincode, receiverName: seed.receiver_name, receiverPhone: seed.receiver_phone, receiverAddress: seed.receiver_address, receiverCity: seed.receiver_city, receiverPincode: seed.receiver_pincode, packageType: seed.package_type, weightKg: seed.weight_kg, dimensions: seed.dimensions, serviceType: seed.service_type, paymentMode: seed.payment_mode, amount: seed.amount, specialInstructions: seed.special_instructions, originHub: seed.origin_hub, destinationHub: seed.destination_hub, customerPhone: seed.customer_phone || seed.receiver_phone };
      const form = $('form[data-form="new-booking"]');
      Object.entries(values).forEach(([key, value]) => { if (form?.elements[key] && value != null) form.elements[key].value = value; });
    }
  }

  async function assignShipmentModal(id) {
    const shipment = (state.pageData?.shipments || []).find((x) => x.id === id);
    const { couriers = [] } = await Api.get('/couriers');
    if (!couriers.length) return toast('No active couriers are available.', 'error');
    openModal('Assign courier', `Assign ${shipment?.awb || 'shipment'} to an authorized delivery executive.`, modalForm('assign-shipment', `<input type="hidden" name="shipmentId" value="${esc(id)}"><div class="field"><label for="f-courierId">Delivery executive</label><select class="select" name="courierId" id="f-courierId" required>${couriers.filter((c) => c.active).map((c) => `<option value="${esc(c.id)}">${esc(c.name)} · ${esc(c.email)}</option>`).join('')}</select></div><div class="alert info" style="margin-top:14px">Booking assignments update the shipment's operational status and notify the assigned courier.</div>`, 'Assign courier'));
  }

  async function statusModal(id) {
    const shipment = (state.pageData?.shipments || []).find((x) => x.id === id);
    if (!shipment) return toast('Refresh the shipment list and retry.', 'error');
    openModal('Update shipment status', `${shipment.awb} · Current status: ${prettyStatus(shipment.status)}`, modalForm('update-shipment-status', `<input type="hidden" name="shipmentId" value="${esc(id)}"><div class="field"><label for="f-status">New status</label><select class="select" name="status" id="f-status" required>${SHIP_STATUS.map((st) => `<option value="${st}" ${st === shipment.status ? 'selected' : ''}>${esc(prettyStatus(st))}</option>`).join('')}</select></div>${field('remarks','Remarks',{type:'textarea',placeholder:'Reason or handover note'})}${field('location','Location / hub',{placeholder:'Optional hub or route location'})}<div class="alert warning" style="margin-top:14px">The backend validates status transition rules. Selecting a status that is not a valid next step will be rejected.</div>`, 'Update status'));
  }

  async function podModal(id) {
    const shipment = [...(state.pageData?.shipments || []), ...(state.pageData?.needPod || []), ...(state.pageData?.activeShips || [])].find((x) => x.id === id);
    openModal('Capture proof of delivery', `${shipment?.awb || 'Shipment'} · Confirm receiver before completing delivery.`, `<form data-form="capture-pod" enctype="multipart/form-data"><input type="hidden" name="shipmentId" value="${esc(id)}"><input type="hidden" name="latitude"><input type="hidden" name="longitude"><div class="form-stack">${field('receiverName','Receiver full name',{required:true,value:shipment?.receiver_name || ''})}${field('signatureText','Signature / acknowledgement',{type:'textarea',placeholder:'Typed acknowledgement or signature reference'})}${field('remarks','Delivery remarks',{type:'textarea',placeholder:'Delivered at reception, handed to family member…'})}<div class="field"><label for="f-photo">Delivery photo (optional)</label><input class="input" id="f-photo" type="file" name="photo" accept="image/jpeg,image/png,image/webp"><small class="field-help">JPG, PNG or WEBP; max ${esc('5')} MB in the default configuration.</small></div><div><button class="btn btn-outline btn-small" type="button" data-action="capture-pod-gps">⌖ Capture current GPS</button><span class="field-help" id="pod-gps-result" style="margin-left:8px">Coordinates not captured</span></div></div><div class="modal-footer"><button class="btn btn-outline" type="button" data-action="close-modal">Cancel</button><button class="btn btn-primary" type="submit">Confirm delivered</button></div></form>`, true);
  }

  async function newPickupModal() {
    openModal('Create pickup request', 'Schedule a customer collection and optional package details.', modalForm('new-pickup', `<div class="two-col-form">${field('customerName','Customer name',{value:state.user.name,required:true})}${field('customerPhone','Customer phone',{type:'tel',value:state.user.phone || '',required:true})}${field('address','Pickup address',{required:true,className:'span-2'})}${field('city','City',{required:true})}${field('pincode','Pincode',{required:true})}${field('requestedDate','Pickup date',{type:'date',value:new Date().toISOString().slice(0,10),required:true})}${field('packageCount','Package count',{type:'number',value:'1',min:'1',max:'1000',required:true})}${field('notes','Pickup notes',{type:'textarea',className:'span-2',placeholder:'Preferred time, package handling…'})}</div>`, 'Create pickup'));
  }

  async function assignPickupModal(id) {
    const { couriers = [] } = await Api.get('/couriers');
    if (!couriers.some((c) => c.active)) return toast('No active couriers are available.', 'error');
    openModal('Assign pickup', 'Choose an active courier for this collection.', modalForm('assign-pickup', `<input type="hidden" name="pickupId" value="${esc(id)}"><div class="field"><label for="f-courierId">Delivery executive</label><select class="select" name="courierId" id="f-courierId" required>${couriers.filter((c) => c.active).map((c) => `<option value="${esc(c.id)}">${esc(c.name)} · ${esc(c.email)}</option>`).join('')}</select></div>`, 'Assign pickup'));
  }
  function updatePickupModal(id, current) {
    const statuses = ['REQUESTED','ASSIGNED','IN_PROGRESS','COMPLETED','CANCELLED'];
    openModal('Update pickup status', `Current status: ${prettyStatus(current)}`, modalForm('update-pickup-status', `<input type="hidden" name="pickupId" value="${esc(id)}"><div class="field"><label for="f-status">Status</label><select class="select" id="f-status" name="status" required>${statuses.map((s) => `<option value="${s}" ${s === current ? 'selected' : ''}>${esc(prettyStatus(s))}</option>`).join('')}</select></div>`, 'Save status'));
  }

  async function generateDrsModal() {
    const [shipResult, courierResult] = await Promise.all([Api.get('/shipments'), Api.get('/couriers')]);
    const eligible = (shipResult.shipments || []).filter((s) => !['DELIVERED','RTO_DELIVERED','CANCELLED'].includes(s.status));
    const couriers = (courierResult.couriers || []).filter((c) => c.active);
    if (!eligible.length || !couriers.length) return toast('You need eligible shipments and an active courier to generate a DRS.', 'error');
    const body = `<form data-form="generate-drs"><div class="two-col-form"><div class="field"><label for="f-courierId">Courier</label><select class="select" name="courierId" id="f-courierId" required>${couriers.map((c) => `<option value="${esc(c.id)}">${esc(c.name)}</option>`).join('')}</select></div>${field('scheduledDate','Scheduled date',{type:'date',value:new Date().toISOString().slice(0,10),required:true})}<div class="form-section">Select shipments</div><div class="span-2" style="display:grid;gap:8px;max-height:290px;overflow:auto">${eligible.map((s) => `<label class="checkbox-row"><input type="checkbox" name="shipmentIds" value="${esc(s.id)}"><span><strong>${esc(s.awb)} · ${esc(s.receiver_name)}</strong><small>${esc(s.receiver_city)} · ${esc(prettyStatus(s.status))}</small></span>${chip(s.status)}</label>`).join('')}</div></div><div class="modal-footer"><button class="btn btn-outline" type="button" data-action="close-modal">Cancel</button><button class="btn btn-primary" type="submit">Generate DRS</button></div></form>`;
    openModal('Generate delivery run sheet', 'Assign selected shipments to one courier and create a traceable DRS record.', body, true);
  }

  async function newFinanceModal() {
    openModal('Add financial entry', 'Record a shipping income or operational expense.', modalForm('new-finance', `<div class="two-col-form"><div class="field"><label for="f-kind">Entry type</label><select class="select" name="kind" id="f-kind" required><option value="INCOME">Income</option><option value="EXPENSE">Expense</option></select></div>${field('category','Category',{required:true,placeholder:'Shipping fee, fuel, packaging…'})}${field('amount','Amount (₹)',{type:'number',required:true,min:'0.01',step:'0.01'})}${field('entryDate','Entry date',{type:'date',value:new Date().toISOString().slice(0,10),required:true})}${field('reference','Reference',{placeholder:'Invoice, bill or receipt number'})}${field('description','Description',{type:'textarea',className:'span-2'})}</div>`, 'Save entry'));
  }

  async function viewShipment(id) {
    const found = (state.pageData?.shipments || state.pageData?.needPod || []).find((s) => s.id === id);
    if (!found) return toast('Shipment is no longer in the current list. Refresh and try again.', 'error');
    try {
      const detail = await Api.get(`/shipments/track/${encodeURIComponent(found.awb)}`);
      const s = detail.shipment;
      const events = detail.events || [];
      openModal(`Shipment ${s.awb}`, 'Shipment detail and traceable status history.', `<div class="shipment-detail-grid"><div class="detail-box"><small>Status</small><strong>${chip(s.status)}</strong></div><div class="detail-box"><small>Service</small><strong>${esc(s.service_type)} · ${esc(s.weight_kg)} kg</strong></div><div class="detail-box"><small>Sender</small><strong>${esc(s.sender_name)}<br>${esc(s.sender_city)} · ${esc(s.sender_phone)}</strong></div><div class="detail-box"><small>Receiver</small><strong>${esc(s.receiver_name)}<br>${esc(s.receiver_city)} · ${esc(s.receiver_phone)}</strong></div><div class="detail-box"><small>Origin</small><strong>${esc(s.sender_address)}<br>${esc(s.sender_city)} · ${esc(s.sender_pincode)}</strong></div><div class="detail-box"><small>Destination</small><strong>${esc(s.receiver_address)}<br>${esc(s.receiver_city)} · ${esc(s.receiver_pincode)}</strong></div><div class="detail-box"><small>Courier</small><strong>${esc(s.courier_name || 'Unassigned')}</strong></div><div class="detail-box"><small>Booking amount</small><strong>${esc(money(s.amount))} · ${esc(s.payment_mode)}</strong></div></div><div class="panel-title" style="margin-top:22px;margin-bottom:14px">Tracking history</div><div class="timeline">${events.map((e,i) => `<div class="timeline-item ${i === events.length-1 ? 'current' : 'done'}"><span class="timeline-node"></span><strong>${esc(prettyStatus(e.status))}</strong><small>${esc(e.location || e.remarks || '')} · ${esc(dateLabel(e.created_at,true))}</small></div>`).join('')}</div><div class="modal-footer"><button class="btn btn-outline" type="button" data-action="close-modal">Close</button>${state.user.role === 'ADMIN' ? btn('Update status', 'status-from-modal', 'btn-primary', `data-id="${esc(s.id)}"`) : ''}</div>`, true);
    } catch (err) { showError(err); }
  }

  async function viewDrs(id) {
    try {
      const { drs, shipments = [] } = await Api.get(`/drs/${encodeURIComponent(id)}`);
      openModal(drs.drs_number, `${drs.courier_name || 'Assigned courier'} · ${dateLabel(drs.scheduled_date)}`, `<div class="report-stat-grid" style="margin-bottom:18px">${reportStat('Shipments', shipments.length)}${reportStat('DRS status', prettyStatus(drs.status))}${reportStat('Created', dateLabel(drs.created_at))}</div>${shipments.length ? `<div class="table-scroll"><table><thead><tr><th>AWB</th><th>Receiver</th><th>Status</th></tr></thead><tbody>${shipments.map((s) => `<tr><td>${esc(s.awb)}</td><td>${esc(s.receiver_name)}</td><td>${chip(s.status)}</td></tr>`).join('')}</tbody></table></div>` : emptyState('No shipments in this DRS', 'The delivery run sheet has no items.', '▤')}` , true);
    } catch (err) { showError(err); }
  }

  function formObject(form) {
    const obj = {};
    for (const [key, value] of new FormData(form).entries()) {
      if (value instanceof File) continue;
      if (Object.hasOwn(obj, key)) obj[key] = Array.isArray(obj[key]) ? [...obj[key], value] : [obj[key], value];
      else obj[key] = value;
    }
    return obj;
  }
  function setSubmitBusy(form, busy) {
    const submit = $('button[type="submit"]', form);
    if (!submit) return;
    if (busy) { submit.dataset.originalLabel = submit.textContent; submit.disabled = true; submit.textContent = 'Please wait…'; }
    else { submit.disabled = false; if (submit.dataset.originalLabel) submit.textContent = submit.dataset.originalLabel; }
  }
  async function withBusy(form, work) {
    setSubmitBusy(form, true);
    try { await work(); }
    catch (err) { showError(err); }
    finally { if (form.isConnected) setSubmitBusy(form, false); }
  }

  document.addEventListener('click', async (event) => {
    const target = event.target.closest('[data-action]');
    if (!target) return;
    const action = target.dataset.action;
    const id = target.dataset.id;
    try {
      if (action === 'choose-role') {
        const role = target.dataset.role;
        renderLogin(role);
      } else if (action === 'back-to-roles') renderRoleSelection();
      else if (action === 'back-to-phone') renderLogin('CUSTOMER', false, { phone: target.dataset.phone || '' });
      else if (action === 'navigate') setPage(target.dataset.page);
      else if (action === 'toggle-menu') $('#sidebar')?.classList.toggle('open');
      else if (action === 'logout') await logout(true);
      else if (action === 'retry-page') loadPage(state.page);
      else if (action === 'close-modal') closeModal();
      else if (action === 'new-booking') await newBookingModal();
      else if (action === 'book-again') { const seed = (state.pageData?.shipments || []).find((x) => x.id === id); if (seed) await newBookingModal(seed); else toast('Previous booking is not available. Refresh and retry.', 'error'); }
      else if (action === 'scroll-booking-history') $('#booking-history')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      else if (action === 'assign-shipment') await assignShipmentModal(id);
      else if (action === 'view-shipment') await viewShipment(id);
      else if (action === 'update-status') await statusModal(id);
      else if (action === 'status-from-modal') { closeModal(); await statusModal(id); }
      else if (action === 'start-delivery') await startDelivery(id);
      else if (action === 'share-location') startLocationWatch(id);
      else if (action === 'capture-pod') await podModal(id);
      else if (action === 'capture-pod-gps') capturePodGps();
      else if (action === 'filter-shipments') {
        state.search = $('#shipment-search')?.value.trim() || '';
        state.statusFilter = $('#shipment-status')?.value || '';
        loadPage('shipments');
      } else if (action === 'filter-customers') {
        state.search = $('#customer-search')?.value.trim() || '';
        loadPage('customers');
      } else if (action === 'new-pickup') await newPickupModal();
      else if (action === 'assign-pickup') await assignPickupModal(id);
      else if (action === 'update-pickup') updatePickupModal(id, target.dataset.status || 'REQUESTED');
      else if (action === 'generate-drs') await generateDrsModal();
      else if (action === 'view-drs') await viewDrs(id);
      else if (action === 'simulate-route') {
        const result = await Api.post(`/demo/simulate/${encodeURIComponent(id)}`, {});
        toast(result.message || 'Demo route simulation started.', 'success');
      } else if (action === 'new-finance') await newFinanceModal();
      else if (action === 'delete-finance') {
        if (confirm('Delete this financial record? An audit log will be retained.')) {
          await Api.delete(`/finance/${encodeURIComponent(id)}`);
          toast('Financial entry deleted.', 'success'); loadPage('finance');
        }
      } else if (action === 'export-csv') {
        await Api.download('/reports/export.csv', 'parcelpilot-shipments.csv'); toast('Shipment export downloaded.', 'success');
      } else if (action === 'retry-sync') {
        const result = await Api.post(`/sync/${encodeURIComponent(id)}/retry`, {}); toast(result.message || 'Sync check completed.', 'success'); loadPage('sync');
      } else if (action === 'mark-notification') {
        await Api.patch(`/notifications/${encodeURIComponent(id)}/read`, {}); loadPage('notifications');
      } else if (action === 'toggle-courier') {
        const active = target.dataset.active !== '1';
        await Api.patch(`/couriers/${encodeURIComponent(id)}`, { active }); toast(active ? 'Courier activated.' : 'Courier deactivated.', 'success'); loadPage('couriers');
      } else if (action === 'show-audit-detail') {
        let value = target.dataset.value;
        try { value = JSON.stringify(JSON.parse(value), null, 2); } catch {}
        openModal('Audit event details', 'Recorded new value for traceability.', `<pre style="white-space:pre-wrap;background:#f7f8fc;border-radius:10px;padding:14px;font-size:11px;line-height:1.6">${esc(value)}</pre><div class="modal-footer"><button class="btn btn-outline" data-action="close-modal" type="button">Close</button></div>`);
      }
    } catch (err) { showError(err); }
  });

  document.addEventListener('submit', async (event) => {
    const form = event.target.closest('form[data-form]');
    if (!form) return;
    event.preventDefault();
    const kind = form.dataset.form;
    await withBusy(form, async () => {
      if (kind === 'staff-login') {
        const body = formObject(form);
        const result = await Api.post('/auth/staff/login', body);
        await setUser(result.user, true);
      } else if (kind === 'customer-phone') {
        const body = formObject(form);
        const result = await Api.post('/auth/customer/request-otp', body);
        renderLogin('CUSTOMER', true, { phone: body.phone, demoCode: result.demoCode || '' });
        toast(result.message || 'OTP requested.', 'success');
      } else if (kind === 'customer-otp') {
        const result = await Api.post('/auth/customer/verify-otp', formObject(form));
        await setUser(result.user, true);
      } else if (kind === 'new-booking') {
        const result = await Api.post('/shipments', formObject(form));
        closeModal(); toast(`Booking created · AWB ${result.shipment.awb}`, 'success'); state.page = 'shipments'; state.search = ''; state.statusFilter = ''; renderShell();
      } else if (kind === 'assign-shipment') {
        const body = formObject(form); await Api.post(`/shipments/${encodeURIComponent(body.shipmentId)}/assign`, body); closeModal(); toast('Courier assigned successfully.', 'success'); loadPage(state.page);
      } else if (kind === 'update-shipment-status') {
        const body = formObject(form); await Api.post(`/shipments/${encodeURIComponent(body.shipmentId)}/status`, body); closeModal(); toast('Shipment status updated.', 'success'); loadPage(state.page);
      } else if (kind === 'capture-pod') {
        const formData = new FormData(form);
        const shipmentId = formData.get('shipmentId');
        await Api.postForm(`/pod/${encodeURIComponent(shipmentId)}`, formData);
        closeModal(); stopLocationWatch(); toast('POD saved. Shipment marked delivered and tracking stopped.', 'success'); loadPage(state.page);
      } else if (kind === 'new-pickup') {
        await Api.post('/pickups', formObject(form)); closeModal(); toast('Pickup request created.', 'success'); loadPage('pickups');
      } else if (kind === 'assign-pickup') {
        const body = formObject(form); await Api.post(`/pickups/${encodeURIComponent(body.pickupId)}/assign`, body); closeModal(); toast('Pickup assigned.', 'success'); loadPage('pickups');
      } else if (kind === 'update-pickup-status') {
        const body = formObject(form); await Api.patch(`/pickups/${encodeURIComponent(body.pickupId)}/status`, body); closeModal(); toast('Pickup status updated.', 'success'); loadPage('pickups');
      } else if (kind === 'generate-drs') {
        const body = formObject(form); body.shipmentIds = $$('input[name="shipmentIds"]:checked', form).map((el) => el.value);
        await Api.post('/drs', body); closeModal(); toast(`DRS generated with ${body.shipmentIds.length} shipment(s).`, 'success'); loadPage('drs');
      } else if (kind === 'new-finance') {
        await Api.post('/finance', formObject(form)); closeModal(); toast('Financial entry saved.', 'success'); loadPage('finance');
      } else if (kind === 'delivery-entry-lookup') {
        const body = formObject(form);
        const result = await Api.get(`/shipments/track/${encodeURIComponent(body.awb)}`);
        state.pageData = state.pageData || {};
        state.pageData.shipments = [...(state.pageData.shipments || []).filter((x) => x.id !== result.shipment.id), result.shipment];
        const s = result.shipment;
        const target = $('#delivery-entry-result');
        if (target) target.innerHTML = `<section class="panel"><div class="panel-header"><div><div class="panel-title">${esc(s.awb)}</div><div class="panel-subtitle">${esc(s.receiver_name)} · ${esc(s.receiver_city)}</div></div>${chip(s.status)}</div><div class="panel-body"><div class="shipment-detail-grid"><div class="detail-box"><small>Sender</small><strong>${esc(s.sender_name)}<br>${esc(s.sender_city)}</strong></div><div class="detail-box"><small>Receiver</small><strong>${esc(s.receiver_name)}<br>${esc(s.receiver_phone)}</strong></div><div class="detail-box"><small>Courier</small><strong>${esc(s.courier_name || 'Unassigned')}</strong></div><div class="detail-box"><small>Booked</small><strong>${esc(dateLabel(s.created_at,true))}</strong></div></div><div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:16px">${btn('Update status', 'update-status', 'btn-primary', `data-id="${esc(s.id)}"`)}${s.status === 'OUT_FOR_DELIVERY' ? btn('Capture POD', 'capture-pod', 'btn-outline', `data-id="${esc(s.id)}"`) : ''}</div></div></section>`;
        if (state.socket) state.socket.emit('join-shipment', s.id, () => {});
      } else if (kind === 'track-awb') {
        const body = formObject(form); await trackAwb(body.awb, true);
      } else if (kind === 'quick-track') {
        const body = formObject(form); state.page = 'track'; renderShell(); setTimeout(() => { const input = $('#track-awb'); if (input) input.value = body.awb; trackAwb(body.awb, true); }, 160);
      }
    });
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') closeModal();
    if (event.key === 'Enter' && event.target.id === 'global-search') {
      const value = event.target.value.trim();
      if (value) { state.search = value; state.statusFilter = ''; setPage('shipments'); }
    }
  });

  function capturePodGps() {
    if (!navigator.geolocation) return toast('GPS is not available in this browser.', 'error');
    const result = $('#pod-gps-result');
    if (result) result.textContent = 'Getting GPS…';
    navigator.geolocation.getCurrentPosition((position) => {
      const form = $('form[data-form="capture-pod"]');
      if (!form) return;
      form.elements.latitude.value = String(position.coords.latitude);
      form.elements.longitude.value = String(position.coords.longitude);
      if (result) result.textContent = `${position.coords.latitude.toFixed(5)}, ${position.coords.longitude.toFixed(5)}`;
      toast('POD coordinates captured.', 'success');
    }, (error) => {
      if (result) result.textContent = 'GPS unavailable';
      toast(error.code === 1 ? 'Location permission is required to capture GPS.' : 'Unable to capture GPS coordinates.', 'error');
    }, { enableHighAccuracy: true, maximumAge: 10000, timeout: 15000 });
  }

  async function startDelivery(id) {
    try {
      const result = await Api.post(`/shipments/${encodeURIComponent(id)}/start`, {});
      toast('Delivery started. Live tracking is available after GPS permission.', 'success');
      loadPage('shipments');
      startLocationWatch(id);
    } catch (err) { showError(err); }
  }

  // Start-up always resolves the server-side session and role before showing a protected dashboard.
  authMe();
})();
