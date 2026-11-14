<?php
/**
 * The help API and remote MCP proxy on personalisationhub.com (PH Agent Endpoint 1.8.0, proxy.php).
 * Required from run.php (lib.php and main.php are loaded there). No WordPress, no network:
 * the transport, rate limit and cache are stubs.
 */
namespace AngieSnippets\PhAgentEndpoint___ID__;

require_once dirname( __DIR__ ) . '/snippets/ph-agent-endpoint/proxy.php';

$CONSOLE = '#backlog-tracker|\.web\.app|firebaseapp\.com|cloudfunctions\.net#i';
$UP      = UPSTREAM_HELP_API;

/* A stub world: records upstream calls, answers from $GLOBALS['hp_up'], a counting rate limit and an array cache. */
function hp_io() {
	return array(
		'transport' => function ( $method, $url, $headers, $body, $timeout ) {
			$GLOBALS['hp_calls'][] = compact( 'method', 'url', 'headers', 'body', 'timeout' );
			$f = $GLOBALS['hp_up'];
			return is_callable( $f ) ? $f( $method, $url, $headers, $body ) : $f;
		},
		'rate'      => function ( $bucket, $max, $cost ) {
			$GLOBALS['hp_rate'][ $bucket ] = ( $GLOBALS['hp_rate'][ $bucket ] ?? 0 ) + $cost;
			return $GLOBALS['hp_rate'][ $bucket ] > $max ? 42 : 0;
		},
		'cache_get' => function ( $k ) {
			return $GLOBALS['hp_cache'][ $k ] ?? null;
		},
		'cache_set' => function ( $k, $v, $ttl ) {
			$GLOBALS['hp_cache'][ $k ] = $v;
		},
	);
}
function hp_reset( $up ) {
	$GLOBALS['hp_up']    = $up;
	$GLOBALS['hp_calls'] = array();
	$GLOBALS['hp_rate']  = array();
	$GLOBALS['hp_cache'] = array();
}
function hp( $method, $path, $query = '', $headers = array(), $body = '' ) {
	return proxy_handle( compact( 'method', 'path', 'query', 'headers', 'body' ), hp_io() );
}
function hp_json( $status, $payload, $h = array() ) {
	return array( 'status' => $status, 'headers' => array_merge( array( 'content-type' => 'application/json; charset=utf-8' ), $h ), 'body' => json_encode( $payload, JSON_UNESCAPED_SLASHES ) );
}

/* ---- routes ---- */
ok( null === proxy_route( '/digital-signage/' ) && null === proxy_route( '/' ) && null === proxy_route( '/mcp-guide/' ) && null === proxy_route( '/help-apix/search' ), 'proxy: other paths are not ours' );
ok( array( 'mcp', '/mcp' ) === proxy_route( '/mcp' ) && array( 'mcp', '/mcp' ) === proxy_route( '/mcp/' ) && array( 'mcp', '/mcp' ) === proxy_route( '/help-api/mcp' ), 'proxy: /mcp (and /help-api/mcp) is the MCP route' );
ok( array( 'help', '/search' ) === proxy_route( '/help-api/search' ) && array( 'help', '/article' ) === proxy_route( '/help-api/article/' ), 'proxy: search and article' );
ok( array( 'help', '/data/articles/faq-art-x.json' ) === proxy_route( '/help-api/data/articles/faq-art-x.json' ) && array( 'help', '/data/index.json' ) === proxy_route( '/help-api/data/index.json' ), 'proxy: the published feed' );
ok( array( 'index', '/' ) === proxy_route( '/help-api/' ) && array( 'index', '/' ) === proxy_route( '/help-api' ), 'proxy: /help-api/ is answered here' );
ok( null === proxy_route( '/help-api/../wp-admin/' ) && null === proxy_route( '/help-api//search' ) && array( 'notfound', '/admin' ) === proxy_route( '/help-api/admin' ) && array( 'notfound', '/data/articles/../x.json' ) !== proxy_route( '/help-api/data/articles/../x.json' ), 'proxy: traversal and unknown sub-paths never reach the help service' );

/* ---- forwarding ---- */
$search = array( 'query' => 'add a store', 'results' => array( array( 'id' => 'faq-art-1', 'title' => 'Add a store', 'url' => 'https://personalisationhub.com/support-centre/stores/add-a-store/' ) ) );
hp_reset( hp_json( 200, $search, array( 'cache-control' => 'public, max-age=60', 'x-cache' => 'MISS', 'x-ratelimit-limit' => '60', 'x-ratelimit-remaining' => '3', 'set-cookie' => 'a=b', 'server' => 'Google Frontend' ) ) );
$r = hp( 'GET', '/help-api/search', 'q=add%20a%20store&limit=3', array( 'accept' => 'application/json', 'cookie' => 'wordpress_logged_in=secret', 'x-forwarded-for' => '1.2.3.4', 'origin' => 'https://agent.example' ) );
$c = $GLOBALS['hp_calls'][0];
ok( 1 === count( $GLOBALS['hp_calls'] ) && 'GET' === $c['method'] && $UP . '/search?q=add%20a%20store&limit=3' === $c['url'], 'proxy: GET /help-api/search is forwarded with its query' );
ok( PROXY_HELP_TIMEOUT === $c['timeout'] && $c['timeout'] <= 10, 'proxy: a short timeout on help routes' );
ok( ! isset( $c['headers']['Cookie'] ) && ! isset( $c['headers']['X-Forwarded-For'] ) && 'application/json' === $c['headers']['Accept'] && 'https://agent.example' === $c['headers']['Origin'], 'proxy: only allow-listed request headers go upstream (no cookies, no client address)' );
ok( 200 === $r['status'] && json_decode( $r['body'], true ) === $search, 'proxy: same status and JSON' );
ok( 'application/json; charset=utf-8' === $r['headers']['Content-Type'] && 'public, max-age=60' === $r['headers']['Cache-Control'] && 'MISS' === $r['headers']['X-Cache'], 'proxy: content type, cache-control and X-Cache passed through' );
ok( ! isset( $r['headers']['Set-Cookie'] ) && ! isset( $r['headers']['Server'] ) && '60' === $r['headers']['X-RateLimit-Limit'] && ! isset( $r['headers']['X-RateLimit-Remaining'] ), 'proxy: upstream cookies, server name and its shared rate counters are dropped; our own limit is stated' );
ok( '*' === $r['headers']['Access-Control-Allow-Origin'] && 'nosniff' === $r['headers']['X-Content-Type-Options'] && false !== strpos( $r['headers']['Content-Security-Policy'], "default-src 'none'" ), 'proxy: CORS open, nosniff, CSP' );

/* shared cache: the second identical GET does not go upstream */
$r2 = hp( 'GET', '/help-api/search', 'q=add%20a%20store&limit=3', array( 'accept' => 'application/json' ) );
ok( 1 === count( $GLOBALS['hp_calls'] ) && 'HIT' === $r2['headers']['X-Cache'] && $r2['body'] === $r['body'], 'proxy: an identical GET within 60 s is answered from the cache' );
hp( 'GET', '/help-api/search', 'q=add%20a%20store&limit=3', array( 'accept' => 'text/markdown' ) );
ok( 2 === count( $GLOBALS['hp_calls'] ), 'proxy: JSON and markdown never share a cache entry' );

/* article: Vary: Accept, markdown passes through */
hp_reset( array( 'status' => 200, 'headers' => array( 'content-type' => 'text/markdown; charset=utf-8' ), 'body' => "# Add a store\n\nSee [the console](https://backlog-tracker-e4ed2.web.app/faq/article.html?id=faq-art-2).\n" ) );
$r = hp( 'GET', '/help-api/article', 'id=faq-art-1&format=md' );
ok( 200 === $r['status'] && 0 === strpos( $r['body'], '# Add a store' ) && 'Accept' === $r['headers']['Vary'], 'proxy: markdown article with Vary: Accept' );
ok( false !== strpos( $r['body'], '(https://personalisationhub.com/support-centre/article.html?id=faq-art-2)' ) && ! preg_match( $CONSOLE, $r['body'] ), 'proxy: a console article link in markdown becomes its /support-centre/ address' );

/* status pass-through */
hp_reset( hp_json( 404, array( 'error' => 'not_found', 'error_description' => 'No published article with that id.' ) ) );
$r = hp( 'GET', '/help-api/article', 'id=nope' );
ok( 404 === $r['status'] && 'not_found' === json_decode( $r['body'], true )['error'] && array() === $GLOBALS['hp_cache'], 'proxy: a 404 is passed through and not cached' );
hp_reset( hp_json( 429, array( 'error' => 'rate_limited' ), array( 'retry-after' => '17' ) ) );
$r = hp( 'GET', '/help-api/search', 'q=x' );
ok( 429 === $r['status'] && '17' === $r['headers']['Retry-After'], 'proxy: the help service\'s own 429 and Retry-After are passed through' );

/* ---- timeouts and failures: 504 / 502, nothing about the help service in the body ---- */
hp_reset( array( 'error' => 'timeout' ) );
$r = hp( 'GET', '/help-api/search', 'q=store' );
ok( 504 === $r['status'] && 'upstream_timeout' === json_decode( $r['body'], true )['error'] && 'no-store' === $r['headers']['Cache-Control'], 'proxy: a timeout answers 504, not cached' );
ok( ! preg_match( $CONSOLE, $r['body'] . json_encode( $r['headers'] ) ), 'proxy: the 504 never names the console host' );
hp_reset( array( 'error' => 'unavailable' ) );
$r = hp( 'GET', '/help-api/search', 'q=store' );
ok( 502 === $r['status'] && 'upstream_unavailable' === json_decode( $r['body'], true )['error'] && ! preg_match( $CONSOLE, $r['body'] ), 'proxy: a connection failure answers 502 with no console host' );
hp_reset( null );
ok( 502 === hp( 'GET', '/help-api/search', 'q=store' )['status'], 'proxy: a broken transport answer is a 502' );
hp_reset( array( 'error' => 'timeout' ) );
$r = hp( 'POST', '/mcp', '', array( 'content-type' => 'application/json' ), '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' );
$d = json_decode( $r['body'], true );
ok( 504 === $r['status'] && '2.0' === $d['jsonrpc'] && -32603 === $d['error']['code'] && ! preg_match( $CONSOLE, $r['body'] ), 'proxy: an MCP timeout is a 504 JSON-RPC error with no console host' );
ok( PROXY_MCP_TIMEOUT === $GLOBALS['hp_calls'][0]['timeout'] && PROXY_MCP_TIMEOUT <= 15, 'proxy: MCP calls have their own short timeout' );

/* ---- methods and sizes ---- */
hp_reset( hp_json( 200, array() ) );
$r = hp( 'POST', '/help-api/search', 'q=x' );
ok( 405 === $r['status'] && 'GET' === $r['headers']['Allow'] && array() === $GLOBALS['hp_calls'], 'proxy: POST to search is 405 here, never forwarded' );
$r = hp( 'OPTIONS', '/mcp' );
ok( 204 === $r['status'] && false !== strpos( $r['headers']['Access-Control-Allow-Headers'], 'Mcp-Session-Id' ) && array() === $GLOBALS['hp_calls'], 'proxy: CORS preflight answered here, allowing Mcp-Session-Id' );
$r = hp( 'POST', '/mcp', '', array(), str_repeat( 'a', PROXY_BODY_MAX + 1 ) );
ok( 413 === $r['status'] && array() === $GLOBALS['hp_calls'], 'proxy: an oversized MCP body is refused without forwarding' );
$r = hp( 'GET', '/help-api/admin' );
ok( 404 === $r['status'] && array() === $GLOBALS['hp_calls'] && false !== strpos( $r['body'], 'https://personalisationhub.com/mcp' ) && ! preg_match( $CONSOLE, $r['body'] ), 'proxy: unknown help routes are 404 here, naming the personalisationhub.com endpoints' );
$r = hp( 'GET', '/help-api/' );
$d = json_decode( $r['body'], true );
ok( 200 === $r['status'] && array() === $GLOBALS['hp_calls'] && false !== strpos( $d['endpoints']['mcp'], 'https://personalisationhub.com/mcp' ) && ! preg_match( $CONSOLE, $r['body'] ), 'proxy: GET /help-api/ is a JSON index on personalisationhub.com' );
hp_reset( hp_json( 200, array( 'x' => 1 ) ) );
$r = hp( 'HEAD', '/help-api/search', 'q=x' );
ok( 200 === $r['status'] && '' === $r['body'] && 'GET' === $GLOBALS['hp_calls'][0]['method'], 'proxy: HEAD is a GET upstream with no body' );

/* ---- MCP: body, session headers, GET/SSE ---- */
$seen = null;
hp_reset( function ( $m, $u, $h, $b ) use ( &$seen ) {
	$seen = array( $m, $u, $h, $b );
	return hp_json( 200, array( 'jsonrpc' => '2.0', 'id' => 7, 'result' => array( 'protocolVersion' => '2025-06-18', 'serverInfo' => array( 'name' => 'personalisation-hub', 'websiteUrl' => 'https://personalisationhub.com' ) ) ), array( 'mcp-session-id' => 'sess-123', 'x-cache' => 'MISS' ) );
} );
$init = '{"jsonrpc":"2.0","id":7,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"t","version":"1"}}}';
$r    = hp( 'POST', '/mcp', '', array( 'content-type' => 'application/json', 'accept' => 'application/json, text/event-stream', 'mcp-session-id' => 'sess-123', 'mcp-protocol-version' => '2025-06-18' ), $init );
ok( 'POST' === $seen[0] && $UP . '/mcp' === $seen[1] && $init === $seen[3], 'proxy: the JSON-RPC body is forwarded unchanged to the MCP endpoint' );
ok( 'sess-123' === $seen[2]['Mcp-Session-Id'] && '2025-06-18' === $seen[2]['Mcp-Protocol-Version'] && 'application/json, text/event-stream' === $seen[2]['Accept'] && 'application/json' === $seen[2]['Content-Type'], 'proxy: Mcp-Session-Id, Mcp-Protocol-Version, Accept and Content-Type go upstream' );
ok( 200 === $r['status'] && 'sess-123' === $r['headers']['Mcp-Session-Id'] && 7 === json_decode( $r['body'], true )['id'], 'proxy: Mcp-Session-Id comes back, with the answer' );
$r2 = hp( 'POST', '/mcp', '', array( 'content-type' => 'application/json', 'mcp-protocol-version' => '2025-06-18' ), str_replace( '"id":7', '"id":"abc"', $init ) );
ok( 1 === count( $GLOBALS['hp_calls'] ) && 'HIT' === $r2['headers']['X-Cache'] && 'abc' === json_decode( $r2['body'], true )['id'], 'proxy: a repeated MCP question is answered from the cache with the caller\'s own id' );
hp_reset( hp_json( 405, array( 'error' => 'method_not_allowed', 'error_description' => 'POST JSON-RPC messages to this endpoint.' ), array( 'allow' => 'POST' ) ) );
$r = hp( 'GET', '/mcp', '', array( 'accept' => 'text/event-stream' ) );
ok( 405 === $r['status'] && 'POST' === $r['headers']['Allow'] && 'GET' === $GLOBALS['hp_calls'][0]['method'], 'proxy: GET /mcp (the SSE stream) is forwarded; the stateless server answers 405 Allow: POST, as before' );
hp_reset( array( 'status' => 202, 'headers' => array(), 'body' => '' ) );
$r = hp( 'POST', '/mcp', '', array( 'content-type' => 'application/json' ), '{"jsonrpc":"2.0","method":"notifications/initialized"}' );
ok( 202 === $r['status'] && '' === $r['body'], 'proxy: a notification answers 202 with no body' );
hp_reset( array( 'status' => 200, 'headers' => array( 'content-type' => 'text/event-stream' ), 'body' => "event: message\ndata: {\"jsonrpc\":\"2.0\",\"id\":1,\"result\":{\"u\":\"https://backlog-tracker-e4ed2.web.app/help-api/search\"}}\n\n" ) );
$r = hp( 'POST', '/mcp', '', array(), '{"jsonrpc":"2.0","id":1,"method":"ping"}' );
ok( 'text/event-stream' === $r['headers']['Content-Type'] && false !== strpos( $r['body'], 'https://personalisationhub.com/help-api/search' ) && ! preg_match( $CONSOLE, $r['body'] ), 'proxy: an event-stream answer passes through, rewritten' );

/* ---- rate limiting ---- */
hp_reset( hp_json( 200, array( 'results' => array() ) ) );
for ( $i = 0; $i < RATE_HELP_MAX; $i++ ) {
	$r = hp( 'GET', '/help-api/search', 'q=s' . $i );
}
ok( 200 === $r['status'], 'proxy: requests up to the limit are served' );
$r = hp( 'GET', '/help-api/search', 'q=s0' );
$d = json_decode( $r['body'], true );
ok( 429 === $r['status'] && '42' === $r['headers']['Retry-After'] && 'no-store' === $r['headers']['Cache-Control'] && 'rate_limited' === $d['error'], 'proxy: past 60 a minute the help API answers 429 with Retry-After, even for a cached answer' );
ok( ! preg_match( '/\d+\.\d+\.\d+\.\d+/', $r['body'] ) && ! preg_match( $CONSOLE, $r['body'] ), 'proxy: the 429 echoes no address and no console host' );
hp_reset( hp_json( 200, array( array( 'jsonrpc' => '2.0', 'id' => 1, 'result' => array() ) ) ) );
$batch = json_encode( array_map( function ( $i ) { return array( 'jsonrpc' => '2.0', 'id' => $i, 'method' => 'ping' ); }, range( 1, 20 ) ) );
ok( 200 === hp( 'POST', '/mcp', '', array(), $batch )['status'] && 20 === $GLOBALS['hp_rate']['mcp'], 'proxy: an MCP batch is charged one per message' );
ok( 429 === hp( 'POST', '/mcp', '', array(), $batch )['status'] && 1 === count( $GLOBALS['hp_calls'] ), 'proxy: MCP past 30 a minute is 429 and not forwarded' );
ok( ! isset( $GLOBALS['hp_rate']['help'] ), 'proxy: MCP and help routes have separate budgets' );

/* ---- console addresses are rewritten everywhere ---- */
$cases = array(
	'https://backlog-tracker-e4ed2.web.app/help-api/mcp'                          => 'https://personalisationhub.com/mcp',
	'https://backlog-tracker-e4ed2.web.app/help-api/search?q=a%20b'               => 'https://personalisationhub.com/help-api/search?q=a%20b',
	'https://backlog-tracker-e4ed2.web.app/help-api/'                             => 'https://personalisationhub.com/help-api/',
	'https://backlog-tracker-e4ed2.web.app/help-api'                              => 'https://personalisationhub.com/help-api/',
	'https://us-central1-backlog-tracker-e4ed2.cloudfunctions.net/helpSearch/mcp' => 'https://personalisationhub.com/mcp',
	'https://backlog-tracker-e4ed2.firebaseapp.com/faq/article.html?id=faq-art-9' => 'https://personalisationhub.com/support-centre/article.html?id=faq-art-9',
	'https://backlog-tracker-e4ed2.web.app/faq/category.html?id=c1'               => 'https://personalisationhub.com/support-centre/',
	'https://backlog-tracker-e4ed2.web.app/'                                      => 'https://personalisationhub.com/',
	'https://help-centre.web.app/x'                                               => 'https://personalisationhub.com/',
	'served by backlog-tracker-e4ed2.web.app today'                               => 'served by personalisationhub.com today',
	'https:\/\/backlog-tracker-e4ed2.web.app\/help-api\/mcp'                      => 'https:\/\/personalisationhub.com\/mcp',
	'https://personalisationhub.com/support-centre/a/'                            => 'https://personalisationhub.com/support-centre/a/',
);
foreach ( $cases as $in => $want ) {
	ok( $want === rewrite_console_urls( $in ), "rewrite: $in" );
}
$tool = array( 'jsonrpc' => '2.0', 'id' => 3, 'result' => array(
	'content'           => array( array( 'type' => 'text', 'text' => "# Add a store\n\n[Next](https://backlog-tracker-e4ed2.web.app/faq/article.html?id=faq-art-3)\n\nSource: https://personalisationhub.com/support-centre/stores/add/" ) ),
	'structuredContent' => array( 'results' => array( array( 'url' => 'https://backlog-tracker-e4ed2.web.app/faq/article.html?id=faq-art-4' ) ), 'helpApi' => 'https://backlog-tracker-e4ed2.web.app/help-api/' ),
	'isError'           => false,
) );
$list = array( 'jsonrpc' => '2.0', 'id' => 2, 'result' => array( 'tools' => array( array( 'name' => 'search_help', 'description' => 'Search the Support Centre (also at https://backlog-tracker-e4ed2.web.app/help-api/search).' ) ) ) );
foreach ( array( 'tools/call get_help_article' => $tool, 'tools/list' => $list ) as $label => $payload ) {
	hp_reset( array( 'status' => 200, 'headers' => array( 'content-type' => 'application/json' ), 'body' => json_encode( $payload ) ) ); // json_encode escapes slashes: the escaped form is what is rewritten
	$r = hp( 'POST', '/mcp', '', array(), json_encode( array( 'jsonrpc' => '2.0', 'id' => $payload['id'], 'method' => 'tools/list' ) ) );
	ok( ! preg_match( $CONSOLE, $r['body'] ) && is_array( json_decode( $r['body'], true ) ), "proxy: $label answer has no console host and is still JSON" );
}
ok( false !== strpos( $r['body'], 'https://personalisationhub.com/help-api/search' ), 'proxy: tool descriptions point at the personalisationhub.com help API' );
hp_reset( array( 'status' => 200, 'headers' => array( 'content-type' => 'application/json' ), 'body' => json_encode( $tool ) ) );
$r = hp( 'POST', '/mcp', '', array(), '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"get_help_article","arguments":{"url":"x"}}}' );
$d = json_decode( $r['body'], true );
ok( 'https://personalisationhub.com/support-centre/article.html?id=faq-art-4' === $d['result']['structuredContent']['results'][0]['url'] && false !== strpos( $d['result']['content'][0]['text'], '(https://personalisationhub.com/support-centre/article.html?id=faq-art-3)' ), 'proxy: get_help_article links become /support-centre/ addresses' );
hp_reset( array( 'status' => 302, 'headers' => array( 'location' => 'https://backlog-tracker-e4ed2.web.app/x', 'link' => '<https://backlog-tracker-e4ed2.web.app/>' ), 'body' => '' ) );
$r = hp( 'GET', '/help-api/search', 'q=x' );
ok( 502 === $r['status'] && ! isset( $r['headers']['Location'] ) && ! isset( $r['headers']['Link'] ) && ! preg_match( $CONSOLE, json_encode( $r['headers'] ) ), 'proxy: an upstream redirect is a 502, with no Location or Link header (no console host in headers)' );
hp_reset( array( 'status' => 500, 'headers' => array( 'content-type' => 'text/html' ), 'body' => '<p>Error at https://backlog-tracker-e4ed2.web.app:443/help-api oops backlog-tracker-e4ed2</p>' ) );
$r = hp( 'GET', '/help-api/search', 'q=x' );
ok( 500 === $r['status'] && ! names_console_host( $r['body'] ), 'proxy: even an address the rewrite cannot place is scrubbed before sending' );

/* ---- the public surface names only personalisationhub.com ---- */
ok( 'https://personalisationhub.com/mcp' === MCP_URL && 'https://personalisationhub.com/help-api/' === HELP_API_URL, 'lib.php: MCP_URL and HELP_API_URL are on personalisationhub.com' );
$agents_md = agents_llms_md();
ok( false !== strpos( $agents_md, '[Remote MCP server](https://personalisationhub.com/mcp)' ) && false !== strpos( $agents_md, '[Help API](https://personalisationhub.com/help-api/)' ) && ! preg_match( $CONSOLE, $agents_md ), 'llms.txt For AI agents: personalisationhub.com addresses only' );
$card_json = json_encode( server_card(), JSON_UNESCAPED_SLASHES );
ok( ! preg_match( $CONSOLE, $card_json ) && ! preg_match( $CONSOLE, json_encode( tool_defs(), JSON_UNESCAPED_SLASHES ) ), 'server card and tool definitions never name the console host' );
ok( ! preg_match( $CONSOLE, (string) file_get_contents( dirname( __DIR__ ) . '/snippets/ph-agent-endpoint/webmcp.js' ) ), 'WebMCP loader never names the console host' );
$src = file_get_contents( dirname( __DIR__ ) . '/snippets/ph-agent-endpoint/proxy.php' );
ok( 1 === substr_count( $src, 'backlog-tracker-e4ed2' ), 'proxy.php: the console address appears once, in UPSTREAM_HELP_API (server side)' );
$main = file_get_contents( dirname( __DIR__ ) . '/snippets/ph-agent-endpoint/main.php' );
ok( false !== strpos( $main, "require_once __DIR__ . '/proxy.php';" ) && false !== strpos( $main, "add_action( 'parse_request'" ) && false !== strpos( $main, 'Version 1.8.0' ), 'main.php 1.8.0 loads proxy.php and serves it at parse_request' );
