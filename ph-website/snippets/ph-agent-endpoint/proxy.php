<?php
/**
 * PH Agent Endpoint: the public help API and remote MCP server, served from personalisationhub.com (1.8.0).
 *
 *   GET  /help-api/                 a short JSON index of the endpoints (answered here)
 *   GET  /help-api/search?q=...     search the Support Centre (JSON)
 *   GET  /help-api/article?id=...   one article (JSON, or markdown with format=md / Accept: text/markdown)
 *   GET  /help-api/data/...         the published feed (index.json, releases.json, articles/<id>.json)
 *   POST /mcp                       the read-only remote MCP server (streamable HTTP, JSON-RPC; GET answers 405)
 *
 * Every route is forwarded server to server to the help service, and its answer is returned with the same status
 * and body. The help service's own address lives only in UPSTREAM_HELP_API below: it is never printed, linked or
 * returned. Any address of that kind inside an answer (article links, tool results, descriptions) is rewritten to
 * the personalisationhub.com equivalent before it leaves (rewrite_console_urls()).
 *
 * Pure helpers (no WordPress calls), so tests run offline: main.php supplies the transport, rate limit and cache.
 */
namespace AngieSnippets\PhAgentEndpoint___ID__;

/** Server side only. Never echo, link or log this. */
const UPSTREAM_HELP_API  = 'https://backlog-tracker-e4ed2.web.app/help-api';
const PROXY_HELP_TIMEOUT = 6;
const PROXY_MCP_TIMEOUT  = 12;
const PROXY_BODY_MAX     = 65536;
const PROXY_QUERY_MAX    = 2000;
/** Requests per address per minute (the help service's own limits; an MCP batch counts each message). */
const RATE_HELP_MAX = 60;
const RATE_MCP_MAX  = 30;
/** Seconds a successful answer is kept and shared between callers (the help service caches 60 s too). */
const PROXY_CACHE_TTL = 60;
/** Hosts of the console and its functions: none may appear in anything served. */
const CONSOLE_HOST_RE = '[a-z0-9-]+(?:\.[a-z0-9-]+)*\.(?:web\.app|firebaseapp\.com|cloudfunctions\.net)';

/**
 * Which route a request path is, or null when it is not ours. Returns [kind, upstream path]:
 * kind 'index' (answered here), 'help' (forwarded GET) or 'mcp' (forwarded JSON-RPC).
 */
function proxy_route( $path ) {
	$p = (string) parse_url( (string) $path, PHP_URL_PATH );
	if ( '' === $p || false !== strpos( $p, '..' ) || false !== strpos( $p, '//' ) ) {
		return null;
	}
	$p = rtrim( $p, '/' );
	if ( '/mcp' === $p || '/help-api/mcp' === $p ) {
		return array( 'mcp', '/mcp' );
	}
	if ( '/help-api' === $p ) {
		return array( 'index', '/' );
	}
	if ( 0 !== strpos( $p, '/help-api/' ) ) {
		return null;
	}
	$sub = substr( $p, strlen( '/help-api' ) );
	if ( '/search' === $sub || '/article' === $sub || 1 === preg_match( '#^/data/(index\.json|releases\.json|articles/[A-Za-z0-9_-]{1,128}\.json)$#', $sub ) ) {
		return array( 'help', $sub );
	}
	return array( 'notfound', $sub );
}

/** The help service URL for a route; the query string is passed on as sent (capped). */
function proxy_upstream_url( $sub, $query ) {
	$q = substr( (string) $query, 0, PROXY_QUERY_MAX );
	return UPSTREAM_HELP_API . $sub . ( '' !== $q ? '?' . $q : '' );
}

/** Request headers passed on (lower-case names in, canonical names out). Nothing else: no cookies, no client address. */
function proxy_request_headers( array $in ) {
	$keep = array( 'accept' => 'Accept', 'content-type' => 'Content-Type', 'mcp-session-id' => 'Mcp-Session-Id', 'mcp-protocol-version' => 'Mcp-Protocol-Version', 'last-event-id' => 'Last-Event-ID', 'if-none-match' => 'If-None-Match', 'origin' => 'Origin' );
	$out  = array( 'User-Agent' => 'PersonalisationHub-HelpProxy/1.0' );
	foreach ( $in as $k => $v ) {
		$k = strtolower( (string) $k );
		if ( isset( $keep[ $k ] ) && is_string( $v ) && strlen( $v ) <= 500 && 1 !== preg_match( '/[\r\n]/', $v ) ) {
			$out[ $keep[ $k ] ] = $v;
		}
	}
	return $out;
}

/** CORS and hardening headers on every answer (public, read-only, never uses cookies). */
function proxy_base_headers() {
	return array(
		'Access-Control-Allow-Origin'   => '*',
		'Access-Control-Allow-Methods'  => 'GET, POST, OPTIONS',
		'Access-Control-Allow-Headers'  => 'Content-Type, Accept, Mcp-Session-Id, Mcp-Protocol-Version, Last-Event-ID',
		'Access-Control-Expose-Headers' => 'Mcp-Session-Id, Retry-After, X-RateLimit-Limit, X-Cache',
		'X-Content-Type-Options'        => 'nosniff',
		'Content-Security-Policy'       => "default-src 'none'; frame-ancestors 'none'",
		'Cross-Origin-Resource-Policy'  => 'cross-origin',
		'Referrer-Policy'               => 'no-referrer',
		'X-Robots-Tag'                  => 'noindex',
	);
}

/** Response headers passed back from the help service (lower-case names in). Its own rate-limit counters are not: they count this server, not the caller. */
function proxy_response_headers( array $up ) {
	$keep = array( 'content-type' => 'Content-Type', 'mcp-session-id' => 'Mcp-Session-Id', 'mcp-protocol-version' => 'Mcp-Protocol-Version', 'retry-after' => 'Retry-After', 'x-cache' => 'X-Cache', 'vary' => 'Vary', 'etag' => 'ETag', 'cache-control' => 'Cache-Control', 'allow' => 'Allow' );
	$out  = array();
	foreach ( $up as $k => $v ) {
		$k = strtolower( (string) $k );
		if ( is_array( $v ) ) {
			$v = implode( ', ', $v );
		}
		if ( isset( $keep[ $k ] ) && is_string( $v ) && 1 !== preg_match( '/[\r\n]/', $v ) ) {
			$out[ $keep[ $k ] ] = rewrite_console_urls( $v );
		}
	}
	return $out;
}

/** The personalisationhub.com address for a console address's path (and query). */
function console_path_target( $path ) {
	$site = \PH_AE_SITE;
	$p    = (string) $path;
	if ( 1 === preg_match( '#^/(?:help-api|helpSearch)/mcp/?(?=$|[?\#])#', $p ) ) {
		return $site . '/mcp';
	}
	if ( 1 === preg_match( '#^/(?:help-api|helpSearch)(/.*)?$#', $p, $m ) ) {
		return $site . '/help-api' . ( isset( $m[1] ) && '' !== $m[1] ? $m[1] : '/' );
	}
	if ( 1 === preg_match( '#article\.html\?id=([A-Za-z0-9_-]{1,128})#', $p, $m ) ) {
		return $site . '/support-centre/article.html?id=' . $m[1];
	}
	if ( 1 === preg_match( '#^/(?:faq|help|support-centre)(?:/|$)#', $p ) ) {
		return $site . '/support-centre/';
	}
	return $site . '/';
}

/** Rewrite every console address in a string to its personalisationhub.com equivalent; bare host names become personalisationhub.com. */
function rewrite_console_urls( $s ) {
	$s = (string) $s;
	if ( 1 !== preg_match( '#' . CONSOLE_HOST_RE . '#i', $s ) ) {
		return $s;
	}
	$s = preg_replace_callback(
		'#https?:(?:\\\\?/){2}' . CONSOLE_HOST_RE . '((?:\\\\?/)[^\s"\'<>)\]]*)?#i',
		function ( $m ) {
			$escaped = false !== strpos( $m[0], '\\/' );
			$path    = isset( $m[1] ) ? str_replace( '\\/', '/', $m[1] ) : '';
			$to      = console_path_target( $path );
			return $escaped ? str_replace( '/', '\\/', $to ) : $to;
		},
		$s
	);
	$host = (string) parse_url( \PH_AE_SITE, PHP_URL_HOST );
	return preg_replace( '#\b' . CONSOLE_HOST_RE . '\b#i', $host, $s );
}

/** Rewrite a decoded JSON value (strings anywhere, keys included). */
function rewrite_console_value( $v ) {
	if ( is_string( $v ) ) {
		return rewrite_console_urls( $v );
	}
	if ( is_array( $v ) ) {
		$out = array();
		foreach ( $v as $k => $x ) {
			$out[ is_string( $k ) ? rewrite_console_urls( $k ) : $k ] = rewrite_console_value( $x );
		}
		return $out;
	}
	return $v;
}

/** Rewrite an answer body: JSON is decoded and walked (so escaped forms are caught too), anything else is rewritten as text. */
function proxy_rewrite_body( $body, $content_type ) {
	$body = (string) $body;
	if ( '' === $body || 1 !== preg_match( '#' . CONSOLE_HOST_RE . '#i', $body ) ) {
		return $body;
	}
	if ( false !== stripos( (string) $content_type, 'json' ) ) {
		$d = json_decode( $body, true );
		if ( null !== $d || 'null' === trim( $body ) ) {
			return json_encode( rewrite_console_value( $d ), JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE );
		}
	}
	return rewrite_console_urls( $body );
}

/** True when a string still names a console host (used by tests and as a last check before sending). */
function names_console_host( $s ) {
	return 1 === preg_match( '#backlog-tracker|\.web\.app\b|firebaseapp\.com|cloudfunctions\.net#i', (string) $s );
}

function proxy_json( $status, $payload, array $extra = array() ) {
	return array(
		'status'  => (int) $status,
		'headers' => array_merge( proxy_base_headers(), array( 'Content-Type' => 'application/json; charset=utf-8' ), $extra ),
		'body'    => json_encode( $payload, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE ),
	);
}

/** A plain error. On the MCP route it is a JSON-RPC error object, so clients show the message. Never names the help service's address. */
function proxy_error( $kind, $status, $code, $message, array $extra = array() ) {
	if ( 'mcp' === $kind ) {
		return proxy_json( $status, array( 'jsonrpc' => '2.0', 'id' => null, 'error' => array( 'code' => -32603, 'message' => $message ) ), array_merge( array( 'Cache-Control' => 'no-store' ), $extra ) );
	}
	return proxy_json( $status, array( 'error' => $code, 'error_description' => $message ), array_merge( array( 'Cache-Control' => 'no-store' ), $extra ) );
}

/** GET /help-api/: what is here, all on personalisationhub.com. */
function proxy_index() {
	$site = \PH_AE_SITE;
	return proxy_json(
		200,
		array(
			'name'          => 'Personalisation Hub help API',
			'description'   => 'Public, read-only search and articles from the Personalisation Hub Support Centre, and a remote MCP server. No sign-in.',
			'endpoints'     => array(
				'search'  => 'GET ' . $site . '/help-api/search?q={query}&limit={1-20}',
				'article' => 'GET ' . $site . '/help-api/article?id={id} (JSON; add format=md or Accept: text/markdown for markdown)',
				'mcp'     => 'POST ' . $site . '/mcp (streamable HTTP, JSON-RPC)',
			),
			'documentation' => $site . '/support-centre/',
			'llms'          => $site . '/llms.txt',
		),
		array( 'Cache-Control' => 'public, max-age=300' )
	);
}

/** A JSON array (a batch), not an object. array_is_list() needs PHP 8.1. */
function proxy_is_list( array $a ) {
	return array() === $a || array_keys( $a ) === range( 0, count( $a ) - 1 );
}

/** Cache key for an MCP message (its id left out, so the same question from any client shares an entry), or null when it must not be cached. */
function mcp_cache_key( $msg, $protocol ) {
	$cacheable = array( 'initialize', 'tools/list', 'tools/call', 'resources/list', 'resources/read', 'prompts/list', 'resources/templates/list' );
	if ( ! is_array( $msg ) || ! isset( $msg['method'], $msg['id'] ) || ! in_array( $msg['method'], $cacheable, true ) ) {
		return null;
	}
	$m = $msg;
	unset( $m['id'] );
	if ( isset( $m['params'] ) && is_array( $m['params'] ) ) {
		unset( $m['params']['_meta'] );
		if ( 'initialize' === $m['method'] ) {
			$m['params'] = array( 'protocolVersion' => $m['params']['protocolVersion'] ?? null );
		}
	}
	return 'ph_ae_hp_m_' . md5( (string) $protocol . '|' . json_encode( $m ) );
}

/**
 * Handle one request. $req: method, path, query (raw string), headers (lower-case names), body.
 * $io: transport(method, url, headers, body, timeout) -> [status, headers, body] | [error => 'timeout'|'unavailable'],
 *      rate(bucket, max, cost) -> seconds to wait or 0, cache_get(key) -> array|null, cache_set(key, array, ttl).
 * Returns null when the path is not ours, else [status, headers, body].
 */
function proxy_handle( array $req, array $io ) {
	$route = proxy_route( $req['path'] ?? '' );
	if ( ! $route ) {
		return null;
	}
	list( $kind, $sub ) = $route;
	$method  = strtoupper( (string) ( $req['method'] ?? 'GET' ) );
	$headers = array_change_key_case( (array) ( $req['headers'] ?? array() ), CASE_LOWER );
	if ( 'OPTIONS' === $method ) {
		return array( 'status' => 204, 'headers' => array_merge( proxy_base_headers(), array( 'Access-Control-Max-Age' => '600' ) ), 'body' => '' );
	}
	if ( 'index' === $kind ) {
		return proxy_index();
	}
	if ( 'notfound' === $kind ) {
		return proxy_error( 'help', 404, 'not_found', 'Endpoints: GET ' . \PH_AE_SITE . '/help-api/search, GET ' . \PH_AE_SITE . '/help-api/article, POST ' . \PH_AE_SITE . '/mcp.' );
	}
	if ( 'help' === $kind && ! in_array( $method, array( 'GET', 'HEAD' ), true ) ) {
		return proxy_error( 'help', 405, 'method_not_allowed', 'Use GET.', array( 'Allow' => 'GET' ) );
	}
	$body = (string) ( $req['body'] ?? '' );
	if ( strlen( $body ) > PROXY_BODY_MAX ) {
		return proxy_error( $kind, 413, 'too_large', 'Request body too large.' );
	}

	/* Rate limit per caller address, before any cache: an MCP batch is charged one per message. */
	$cost = 1;
	$msg  = null;
	if ( 'mcp' === $kind && 'POST' === $method ) {
		$msg = json_decode( $body, true );
		if ( is_array( $msg ) && proxy_is_list( $msg ) && $msg ) {
			$cost = min( 20, count( $msg ) );
		}
	}
	$max  = 'mcp' === $kind ? RATE_MCP_MAX : RATE_HELP_MAX;
	$wait = (int) call_user_func( $io['rate'], 'mcp' === $kind ? 'mcp' : 'help', $max, $cost );
	$rl   = array( 'X-RateLimit-Limit' => (string) $max );
	if ( $wait > 0 ) {
		return proxy_json( 429, array( 'error' => 'rate_limited', 'error_description' => "Too many requests from this address. Try again in $wait seconds." ), array_merge( $rl, array( 'Retry-After' => (string) $wait, 'Cache-Control' => 'no-store' ) ) );
	}

	/* Shared cache: identical GETs, and single cacheable MCP messages (answer re-stamped with the caller's id). */
	$key = null;
	if ( 'help' === $kind ) {
		$wants_md = 1 === preg_match( '#text/markdown#i', (string) ( $headers['accept'] ?? '' ) ) ? 'md' : 'json';
		$key      = empty( $headers['if-none-match'] ) ? 'ph_ae_hp_g_' . md5( $sub . '?' . substr( (string) ( $req['query'] ?? '' ), 0, PROXY_QUERY_MAX ) . '|' . $wants_md ) : null;
	} elseif ( 'POST' === $method && is_array( $msg ) && ! proxy_is_list( $msg ) ) {
		$key = mcp_cache_key( $msg, $headers['mcp-protocol-version'] ?? '' );
	}
	if ( $key ) {
		$hit = call_user_func( $io['cache_get'], $key );
		if ( is_array( $hit ) && isset( $hit['status'], $hit['headers'], $hit['body'] ) ) {
			if ( 'mcp' === $kind ) {
				$d       = json_decode( $hit['body'], true );
				$d['id'] = $msg['id'];
				$hit['body'] = json_encode( $d, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE );
			}
			$hit['headers']['X-Cache'] = 'HIT';
			$hit['headers']            = array_merge( $hit['headers'], $rl );
			if ( 'HEAD' === $method ) {
				$hit['body'] = '';
			}
			return $hit;
		}
	}

	$up_method = 'HEAD' === $method ? 'GET' : $method;
	$up = call_user_func( $io['transport'], $up_method, proxy_upstream_url( $sub, $req['query'] ?? '' ), proxy_request_headers( $headers ), 'POST' === $method ? $body : null, 'mcp' === $kind ? PROXY_MCP_TIMEOUT : PROXY_HELP_TIMEOUT );
	if ( ! is_array( $up ) || isset( $up['error'] ) || ! isset( $up['status'] ) ) {
		$timeout = is_array( $up ) && 'timeout' === ( $up['error'] ?? '' );
		return $timeout
			? proxy_error( $kind, 504, 'upstream_timeout', 'The help service took too long to answer. Try again shortly.', $rl )
			: proxy_error( $kind, 502, 'upstream_unavailable', 'The help service is not answering. Try again shortly.', $rl );
	}
	$status = (int) $up['status'];
	if ( $status < 100 || $status > 599 || ( $status >= 300 && $status < 400 && 304 !== $status ) ) {
		/* A redirect would point at the help service's own host: never pass one on. */
		return proxy_error( $kind, 502, 'upstream_unavailable', 'The help service is not answering. Try again shortly.', $rl );
	}
	$out_h = array_merge( proxy_base_headers(), proxy_response_headers( (array) ( $up['headers'] ?? array() ) ), $rl );
	if ( 'help' === $kind && '/article' === $sub && ! isset( $out_h['Vary'] ) ) {
		$out_h['Vary'] = 'Accept';
	}
	$ctype = $out_h['Content-Type'] ?? '';
	$out   = array( 'status' => $status, 'headers' => $out_h, 'body' => proxy_rewrite_body( (string) ( $up['body'] ?? '' ), $ctype ) );
	if ( names_console_host( $out['body'] ) ) {
		/* Something the rewrite could not place (a malformed address): never send it. */
		$out['body'] = preg_replace( '#[^\s"\'<>]*(?:backlog-tracker|\.web\.app\b|firebaseapp\.com|cloudfunctions\.net)[^\s"\'<>]*#i', \PH_AE_SITE . '/', $out['body'] );
	}
	if ( $key && 200 === $status ) {
		$store = $out;
		unset( $store['headers']['X-Cache'] );
		$ok = true;
		if ( 'mcp' === $kind ) {
			$d  = json_decode( $out['body'], true );
			$ok = is_array( $d ) && isset( $d['result'] ) && empty( $d['result']['isError'] );
		}
		if ( $ok ) {
			call_user_func( $io['cache_set'], $key, $store, PROXY_CACHE_TTL );
		}
	}
	if ( 'HEAD' === $method ) {
		$out['body'] = '';
	}
	return $out;
}
