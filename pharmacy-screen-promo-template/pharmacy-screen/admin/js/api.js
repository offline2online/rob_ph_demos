// The admin editor's API client. Every read and write goes to the server: the config API (config-api/,
// /api/admin/**) and the PH API settings and Location API proxy (ph-proxy/, /api/settings/**, /api/device/**).
// Nothing is kept in browser storage. Both APIs answer errors as {error: {code, message}}.

export class ApiError extends Error {
  constructor(status, code, message) { super(message); this.status = status; this.code = code; }
}

export function createClient({ apiBase = '', getToken }) {
  const base = String(apiBase || '').replace(/\/+$/, '');

  async function req(method, path, { json, body, contentType, version } = {}) {
    const headers = {};
    const token = getToken ? await getToken() : null;
    if (token) headers.Authorization = `Bearer ${token}`;
    if (json !== undefined) { headers['Content-Type'] = 'application/json'; body = JSON.stringify(json); }
    else if (contentType) headers['Content-Type'] = contentType;
    if (version !== undefined && version !== null) headers['If-Match'] = `"${version}"`;
    let res;
    try {
      res = await fetch(base + path, { method, headers, body, cache: 'no-store' });
    } catch (e) {
      throw new ApiError(0, 'network', 'The server could not be reached. Check your connection and try again.');
    }
    const text = await res.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch { data = null; }
    if (!res.ok) {
      const e = (data && data.error) || {};
      throw new ApiError(res.status, String(e.code || res.status), e.message || `The server answered ${res.status}.`);
    }
    return data;
  }

  const enc = encodeURIComponent;
  return {
    me: () => req('GET', '/api/admin/me'),
    // pharmacies
    listPharmacies: () => req('GET', '/api/admin/pharmacies'),
    getPharmacy: (id) => req('GET', `/api/admin/pharmacies/${enc(id)}`),
    createPharmacy: (body) => req('POST', '/api/admin/pharmacies', { json: body }),
    updatePharmacy: (id, fields, version) => req('PATCH', `/api/admin/pharmacies/${enc(id)}`, { json: fields, version }),
    setContent: (id, promotionId, content, version) => req('PUT', `/api/admin/pharmacies/${enc(id)}/content/${enc(promotionId)}`, { json: content, version }),
    deletePharmacy: (id, version) => req('DELETE', `/api/admin/pharmacies/${enc(id)}`, { version }),
    setLogo: (id, blob) => req('PUT', `/api/admin/pharmacies/${enc(id)}/logo`, { body: blob, contentType: blob.type }),
    removeLogo: (id) => req('DELETE', `/api/admin/pharmacies/${enc(id)}/logo`),
    // promotions
    listPromotions: () => req('GET', '/api/admin/promotions'),
    createPromotion: (body) => req('POST', '/api/admin/promotions', { json: body }),
    updatePromotion: (id, fields, version) => req('PATCH', `/api/admin/promotions/${enc(id)}`, { json: fields, version }),
    deletePromotion: (id, version) => req('DELETE', `/api/admin/promotions/${enc(id)}`, { version }),
    // templates
    listTemplates: () => req('GET', '/api/admin/templates'),
    updateTemplate: (id, fields, version) => req('PATCH', `/api/admin/templates/${enc(id)}`, { json: fields, version }),
    cloneTemplate: (id, name) => req('POST', `/api/admin/templates/${enc(id)}/clone`, { json: { name } }),
    deleteTemplate: (id, version) => req('DELETE', `/api/admin/templates/${enc(id)}`, { version }),
    setBackground: (id, orientation, blob) => req('PUT', `/api/admin/templates/${enc(id)}/backgrounds/${orientation}`, { body: blob, contentType: blob.type }),
    removeBackground: (id, orientation) => req('DELETE', `/api/admin/templates/${enc(id)}/backgrounds/${orientation}`),
    // service library
    listServices: () => req('GET', '/api/admin/services'),
    // PH API settings (write-only token) and the Location API, through the proxy
    getPhApi: () => req('GET', '/api/settings/ph-api').then((r) => r.settings),
    savePhApi: (body) => req('PUT', '/api/settings/ph-api', { json: body }).then((r) => r.settings),
    removePhApiToken: () => req('DELETE', '/api/settings/ph-api/token').then((r) => r.settings),
    campaignData: (deviceId) => req('GET', `/api/device/${enc(deviceId)}/campaign_data`),
    // Download MP4 (config-api/src/video/jobs.js): start a video, then read how far it has got
    startVideo: (body) => req('POST', '/api/admin/videos', { json: body }),
    getVideo: (id) => req('GET', `/api/admin/videos/${enc(id)}`),
  };
}
