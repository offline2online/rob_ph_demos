'use strict';

// The only unauthenticated route.
module.exports = { path: '/health', public: true, handler: () => ({ status: 'ok' }) };
