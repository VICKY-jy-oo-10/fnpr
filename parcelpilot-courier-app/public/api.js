(function () {
  'use strict';
  async function request(path, options = {}) {
    const method = options.method || 'GET';
    const headers = new Headers(options.headers || {});
    let body = options.body;
    if (body !== undefined && !(body instanceof FormData) && typeof body !== 'string') {
      headers.set('Content-Type', 'application/json');
      body = JSON.stringify(body);
    }
    const response = await fetch(`/api${path}`, { method, headers, body, credentials: 'same-origin' });
    const contentType = response.headers.get('content-type') || '';
    if (!response.ok) {
      const payload = contentType.includes('application/json') ? await response.json().catch(() => ({})) : {};
      const error = new Error(payload.error || `Request failed (${response.status}).`);
      error.status = response.status;
      error.code = payload.code;
      throw error;
    }
    if (contentType.includes('text/csv')) return response.blob();
    return contentType.includes('application/json') ? response.json() : response.text();
  }
  window.Api = {
    get: (path) => request(path),
    post: (path, body) => request(path, { method: 'POST', body }),
    patch: (path, body) => request(path, { method: 'PATCH', body }),
    delete: (path) => request(path, { method: 'DELETE' }),
    postForm: (path, formData) => request(path, { method: 'POST', body: formData }),
    download: async (path, filename) => {
      const blob = await request(path);
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = filename;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    }
  };
})();
