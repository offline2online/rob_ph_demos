<?php
/**
 * PH Agent Endpoint (Angie snippet). Version 1.8.0
 *
 * Markdown twins (?format=md), one shared JSON-LD graph and llms.txt sections
 * for the allow-listed pages in lib.php. Industries, Blog and Support Centre
 * keep their own twins and graphs; they reference the shared nodes by @id.
 *
 * Performance (design guide s.7): inline JSON-LD only, no assets, no remote
 * calls; twins are cached in a transient (5 min) plus max-age=300.
 */
namespace AngieSnippets\PhAgentEndpoint___ID__;

if ( ! defined( 'ABSPATH' ) ) {
	return;
}
require_once __DIR__ . '/lib.php';
require_once __DIR__ . '/tools.php';
require_once __DIR__ . '/faq.php';
require_once __DIR__ . '/proxy.php';

/** Plain-array view of a post for is_exposable(). No extra queries beyond meta. */
function post_view( $post ) {
	if ( ! $post ) {
		return array();
	}
	return array(
		'id'       => (int) $post->ID,
		'type'     => $post->post_type,
		'status'   => $post->post_status,
		'password' => $post->post_password,
		'noindex'  => get_post_meta( $post->ID, '_seopress_robots_index', true ) === 'yes',
	);
}

function exposable_post( $id ) {
	$post = get_post( (int) $id );
	return $post && is_exposable( post_view( $post) ) ? $post : null;
}

function page_summary( $post ) {
	$d = trim( (string) get_post_meta( $post->ID, '_seopress_titles_desc', true ) );
	if ( $d === '' ) {
		$d = trim( wp_strip_all_tags( (string) $post->post_excerpt ) );
	}
	return $d;
}

function page_title( $post ) {
	return trim( wp_strip_all_tags( get_the_title( $post ) ) );
}

/** The markdown twin of an exposable page, cached 5 minutes in a transient. */
function twin_for( $post ) {
	$key = 'ph_ae_md_' . $post->ID . '_' . md5( $post->post_modified_gmt );
	$md  = get_transient( $key );
	if ( ! is_string( $md ) || $md === '' ) {
		$html = class_exists( '\Elementor\Plugin' )
			? \Elementor\Plugin::$instance->frontend->get_builder_content_for_display( $post->ID )
			: '';
		if ( trim( (string) $html ) === '' ) {
			$html = apply_filters( 'the_content', $post->post_content );
		}
		$md = markdown_twin( page_title( $post ), page_summary( $post ), page_url( $post->ID ), $html . faq_html( $post->ID ) );
		set_transient( $key, $md, 300 );
	}
	return $md;
}

function current_exposable() {
	if ( ! is_singular( 'page' ) ) {
		return null;
	}
	return exposable_post( get_queried_object_id() );
}

/* JSON-LD, inline in the head. */
add_action( 'wp_head', function () {
	$post = current_exposable();
	if ( ! $post ) {
		return;
	}
	$j = json_ld( graph_for( $post->ID, page_title( $post ), page_summary( $post ) ) );
	if ( $j !== '' ) {
		echo '<script type="application/ld+json">' . $j . "</script>\n";
	}
	echo '<link rel="alternate" type="text/markdown" href="' . esc_url( twin_url( $post->ID ) ) . "\" />\n";
}, 20 );

/* Feature Q&A: FAQPage JSON-LD (its own script tag, same data as the visible block) and the block itself. */
add_action( 'wp_head', function () {
	$post = current_exposable();
	$g    = $post ? faq_graph( $post->ID ) : null;
	if ( $g ) {
		$j = json_ld( $g );
		if ( $j !== '' ) {
			echo '<script type="application/ld+json">' . $j . "</script>\n";
		}
	}
}, 21 );

/* Feature Q&A styling: one small scoped stylesheet, only on pages that have a block. */
add_action( 'wp_head', function () {
	$post = current_exposable();
	if ( $post && faq_for( $post->ID ) ) {
		echo '<style id="ph-faq-css">' . faq_css() . "</style>\n";
	}
}, 22 );

add_filter( 'the_content', function ( $content ) {
	static $done = array();
	if ( is_admin() || ! is_singular( 'page' ) || ! in_the_loop() || ! is_main_query() ) {
		return $content;
	}
	$post = current_exposable();
	if ( ! $post || isset( $done[ $post->ID ] ) || ! faq_for( $post->ID ) ) {
		return $content;
	}
	if ( class_exists( '\Elementor\Plugin' ) && ( \Elementor\Plugin::$instance->editor->is_edit_mode() || \Elementor\Plugin::$instance->preview->is_preview_mode() ) ) {
		return $content;
	}
	$done[ $post->ID ] = true;
	return $content . faq_html( $post->ID ); // phpcs:ignore WordPress.Security.EscapeOutput -- escaped in faq_html().
}, 99 );

/* Markdown twin. */
add_action( 'template_redirect', function () {
	if ( ! isset( $_GET['format'] ) || $_GET['format'] !== 'md' ) {
		return;
	}
	$post = current_exposable();
	if ( ! $post ) {
		return; // not ours: other snippets may serve their own twin; otherwise normal page.
	}
	$md = twin_for( $post );
	status_header( 200 );
	header( 'Content-Type: text/markdown; charset=utf-8' );
	header( 'Link: <' . page_url( $post->ID ) . '>; rel="canonical"' );
	header( 'Cache-Control: public, max-age=300' );
	header( 'X-Content-Type-Options: nosniff' );
	echo $md; // phpcs:ignore WordPress.Security.EscapeOutput -- markdown, served as text/markdown.
	exit;
}, 1 );

/* llms.txt: add sections without rewriting the existing text. */
add_filter( 'ph_llms_txt', function ( $text ) {
	$pages = array();
	foreach ( array_keys( allow_list() ) as $id ) {
		$post = exposable_post( $id );
		if ( $post ) {
			$pages[ $id ] = array( page_title( $post ), page_summary( $post ) );
		}
	}
	return llms_sections( (string) $text, $pages );
}, 20 );

/* Drop cached twins when an allow-listed page changes. */
add_action( 'save_post_page', function ( $id ) {
	if ( isset( allow_list()[ (int) $id ] ) ) {
		$post = get_post( $id );
		if ( $post ) {
			delete_transient( 'ph_ae_md_' . $post->ID . '_' . md5( $post->post_modified_gmt ) );
		}
	}
} );

/* ------------------------------------------------------------------ tools */
/* Shared tool contract (tools.php). The WebMCP loader and the remote MCP server both call this endpoint. */

const IND_NS = 'AngieSnippets\PhIndustryEnhancements_10063\\';
const SC_NS  = 'AngieSnippets\PhSupportCentre_10156\\';
const SC_PT  = 'ph_help_article';

function tools_generation() {
	return (int) get_option( 'ph_ae_gen', 1 );
}

/** Exposable allow-listed pages: id => [title, summary]. */
function live_pages() {
	$pages = array();
	foreach ( array_keys( allow_list() ) as $id ) {
		$post = exposable_post( $id );
		if ( $post ) {
			$pages[ $id ] = array( page_title( $post ), page_summary( $post ) );
		}
	}
	return $pages;
}

/** The nine live industry pages: published, public, not noindex, with markdown held by the Industries snippet. */
function live_industries() {
	if ( ! function_exists( IND_NS . 'data' ) ) {
		return array();
	}
	$md  = call_user_func( IND_NS . 'data', 'md.php' );
	$out = array();
	foreach ( INDUSTRY_SLUGS as $slug ) {
		$post = get_page_by_path( 'industries/' . $slug );
		if ( ! $post || 'publish' !== $post->post_status || ! empty( $post->post_password ) || 'yes' === get_post_meta( $post->ID, '_seopress_robots_index', true ) || ! isset( $md[ $slug ] ) ) {
			continue;
		}
		$lines = explode( "\n", $md[ $slug ] );
		$title = trim( preg_replace( '/^#\s*/', '', $lines[0] ) );
		$sum   = page_summary( $post );
		if ( '' === $sum ) {
			foreach ( array_slice( $lines, 1 ) as $l ) {
				if ( '' !== trim( $l ) && '#' !== $l[0] ) {
					$sum = trim( $l );
					break;
				}
			}
		}
		$out[] = array( $slug, $title, home_url( '/industries/' . $slug . '/' ), mb_strimwidth( $sum, 0, 300, '…' ) );
	}
	return $out;
}

/** The markdown of an industry page (hub or one of the nine): the Industries snippet's twin, with the calculator and tour text generated from their lists. */
function industry_md_for( $slug ) {
	if ( function_exists( IND_NS . 'industry_twin' ) ) {
		return call_user_func( IND_NS . 'industry_twin', $slug );
	}
	if ( function_exists( IND_NS . 'data' ) ) {
		$md = call_user_func( IND_NS . 'data', 'md.php' );
		return $md[ $slug ] ?? null;
	}
	return null;
}

/** The industries hub page, when it is published, public and not noindex. */
function industry_hub_live() {
	$post = get_page_by_path( 'industries' );
	return $post && 'publish' === $post->post_status && empty( $post->post_password ) && 'yes' !== get_post_meta( $post->ID, '_seopress_robots_index', true );
}

function tool_source() {
	return array(
		'pages'       => __NAMESPACE__ . '\live_pages',
		'page_md'     => function ( $id ) {
			$post = exposable_post( $id );
			return $post ? twin_for( $post ) : null;
		},
		'industries'  => __NAMESPACE__ . '\live_industries',
		'industry_md' => function ( $slug ) {
			foreach ( live_industries() as $r ) {
				if ( $r[0] === $slug ) {
					return industry_md_for( $slug );
				}
			}
			return null;
		},
		'search'      => function ( $q, $limit ) {
			if ( ! function_exists( SC_NS . 'search_articles' ) || ! defined( SC_NS . 'LIVE' ) || ! constant( SC_NS . 'LIVE' ) ) {
				return null;
			}
			$had = $_GET['release'] ?? null; // Never let a visitor pick a release: only the live one is served.
			unset( $_GET['release'] );
			$out = array();
			foreach ( array_slice( call_user_func( SC_NS . 'search_articles', call_user_func( SC_NS . 'visible' ), $q ), 0, $limit ) as $a ) {
				$top    = call_user_func( SC_NS . 'parent_cat', $a['cat'] );
				$folder = call_user_func( SC_NS . 'cats' )[ $a['cat'] ] ?? null;
				$out[]  = array( $a['title'], call_user_func( SC_NS . 'art_url', $a ), $top ? $top['name'] : '', ( $top && $folder && $folder['id'] !== $top['id'] ) ? $folder['name'] : '', $a['summary'] );
			}
			if ( null !== $had ) {
				$_GET['release'] = $had;
			}
			return $out;
		},
		'article_md'  => function ( $path ) {
			if ( ! function_exists( SC_NS . 'markdown' ) || ! constant( SC_NS . 'LIVE' ) ) {
				return null;
			}
			unset( $_GET['release'] );
			foreach ( call_user_func( SC_NS . 'visible' ) as $a ) {
				$p = rtrim( (string) wp_parse_url( call_user_func( SC_NS . 'art_url', $a ), PHP_URL_PATH ), '/' ) . '/';
				if ( $p === $path ) {
					return call_user_func( SC_NS . 'markdown', array( 'type' => 'article', 'art' => $a ) );
				}
			}
			return null;
		},
	);
}

/**
 * Fixed-window rate limit per address and bucket (pen test PT-04). The address
 * is hashed with the site salt for the transient key and never stored or logged.
 * Returns seconds to wait when over the limit, else 0.
 */
function rate_hit( $bucket, $max ) {
	$ip  = isset( $_SERVER['REMOTE_ADDR'] ) ? (string) $_SERVER['REMOTE_ADDR'] : 'unknown';
	$win = (int) floor( time() / 60 );
	$key = 'ph_ae_rl_' . $bucket . '_' . substr( md5( $ip . '|' . wp_salt() . '|' . $win ), 0, 20 );
	$n   = (int) get_transient( $key ) + 1;
	set_transient( $key, $n, 90 );
	return rate_wait( $n, (int) apply_filters( 'ph_ae_rate_max_' . $bucket, $max ), ( $win + 1 ) * 60 - time() );
}

/** Run a tool through the 5-minute cache. Only successful results are cached. */
function call_tool_cached( $name, $args ) {
	$key = 'ph_ae_t_' . md5( tools_generation() . '|' . $name . '|' . args_key( $args ) );
	$hit = get_transient( $key );
	if ( is_array( $hit ) ) {
		return $hit;
	}
	$res = run_tool( $name, $args, tool_source() );
	if ( empty( $res['isError'] ) ) {
		set_transient( $key, $res, 300 );
	}
	return $res;
}

add_action( 'rest_api_init', function () {
	register_rest_route( 'ph-agent/v1', '/tools', array(
		'methods'             => 'GET',
		'permission_callback' => '__return_true',
		'callback'            => function () {
			$r = rest_ensure_response( array( 'tools' => tool_defs() ) );
			$r->header( 'Cache-Control', 'public, max-age=300' );
			return $r;
		},
	) );
	register_rest_route( 'ph-agent/v1', '/tools/(?P<name>[a-z_]{1,40})', array(
		'methods'             => 'GET',
		'permission_callback' => '__return_true',
		'callback'            => function ( $req ) {
			$wait = rate_hit( 'tools', RATE_TOOLS_MAX );
			if ( $wait ) {
				$r = rest_ensure_response( tool_error( "Too many requests from this address. Try again in $wait seconds." ) );
				$r->set_status( 429 );
				$r->header( 'Retry-After', (string) $wait );
				$r->header( 'Cache-Control', 'no-store' );
				return $r;
			}
			$raw  = $req->get_param( 'args' );
			$args = array();
			if ( is_string( $raw ) && '' !== $raw ) {
				$args = strlen( $raw ) <= 2000 ? json_decode( $raw, true ) : null;
			}
			$res = ( is_array( $args ) ) ? call_tool_cached( (string) $req['name'], $args ) : tool_error( 'args must be a JSON object of at most 2000 characters.' );
			$r   = rest_ensure_response( $res );
			$r->header( 'Cache-Control', empty( $res['isError'] ) ? 'public, max-age=300' : 'no-store' );
			return $r;
		},
	) );
} );

/*
 * Headers on our routes only (pen test PT-05). WordPress reflects any Origin and
 * allows credentials on REST responses; these routes are public, read-only and
 * never use cookies, so answer "*" without credentials and add nosniff.
 */
add_filter( 'rest_pre_serve_request', function ( $served, $result, $request ) {
	if ( 0 === strpos( (string) $request->get_route(), '/ph-agent/v1' ) ) {
		header_remove( 'Access-Control-Allow-Credentials' );
		header( 'Access-Control-Allow-Origin: *' );
		header( 'Access-Control-Allow-Methods: GET, OPTIONS' );
		header( 'X-Content-Type-Options: nosniff' );
		header( 'Cross-Origin-Resource-Policy: cross-origin' );
	}
	return $served;
}, 20, 3 );

/* Content changed: start a new cache generation (tool results and twins), only for content the tools read. */
add_action( 'save_post', function ( $id, $post ) {
	if ( ! $post ) {
		return;
	}
	$hit = SC_PT === $post->post_type || isset( allow_list()[ (int) $id ] )
		|| ( 'page' === $post->post_type && 0 === strpos( (string) get_page_uri( $post ), 'industries' ) );
	if ( $hit ) {
		update_option( 'ph_ae_gen', tools_generation() + 1, false );
	}
}, 10, 2 );

/* ------------------------------------------------------------------ WebMCP loader */
/* Inline, under 2 KB, exits at once without navigator.modelContext: no request, no work in other browsers. */

function loader_wanted() {
	if ( is_admin() || is_feed() || is_404() ) {
		return false;
	}
	if ( is_singular( 'page' ) ) {
		$post = get_queried_object();
		if ( ! $post ) {
			return false;
		}
		if ( isset( allow_list()[ (int) $post->ID ] ) ) {
			return (bool) exposable_post( $post->ID );
		}
		$uri = (string) get_page_uri( $post );
		return 'industries' === $uri || 0 === strpos( $uri, 'industries/' ) || 'support-centre' === $uri || 'blog' === $uri;
	}
	return is_singular( SC_PT ) || is_tax( 'ph_help_category' ) || is_singular( 'post' );
}

add_action( 'wp_footer', function () {
	if ( ! loader_wanted() ) {
		return;
	}
	$js = @file_get_contents( __DIR__ . '/webmcp.js' ); // phpcs:ignore WordPress.WP.AlternativeFunctions
	if ( ! is_string( $js ) || '' === $js ) {
		return;
	}
	echo '<script>window.PH_AE_REST=' . wp_json_encode( rest_url( 'ph-agent/v1/' ) ) . ';' . $js . "</script>\n"; // phpcs:ignore WordPress.Security.EscapeOutput -- our own file.
}, 99 );

/* ------------------------------------------------------------------ RevOps: tracked CTA hop */
/* /go/free-trial/ and /go/demo/ (ticket 5). Records one ph_agent_cta event and 302s to the exact link held in tools.php. */

const CTA_LOG_OPTION = 'ph_ae_cta_log';
const CTA_LOG_MAX    = 500;

add_action( 'template_redirect', function () {
	$hit = go_target( isset( $_SERVER['REQUEST_URI'] ) ? wp_unslash( $_SERVER['REQUEST_URI'] ) : '' ); // phpcs:ignore WordPress.Security
	if ( ! $hit ) {
		return;
	}
	$over = rate_hit( 'cta', RATE_CTA_MAX ); // Past the limit the visitor is still sent on, but nothing is written (PT-02: no unbounded option writes).
	$via = go_via( isset( $_GET['via'] ) ? (string) wp_unslash( $_GET['via'] ) : '' ); // phpcs:ignore WordPress.Security.NonceVerification
	if ( ! $over ) {
		$ev  = cta_event( $hit[0], $via, isset( $_SERVER['HTTP_REFERER'] ) ? wp_unslash( $_SERVER['HTTP_REFERER'] ) : '', time() ); // phpcs:ignore WordPress.Security
		$log = get_option( CTA_LOG_OPTION, array() );
		$log = is_array( $log ) ? $log : array();
		$log[] = $ev;
		update_option( CTA_LOG_OPTION, array_slice( $log, -CTA_LOG_MAX ), false );
		do_action( 'ph_agent_cta', $ev ); // RevOps listeners (and GTM server-side) hook here.
	}
	nocache_headers();
	header( 'X-Robots-Tag: noindex, nofollow' );
	header( 'Referrer-Policy: no-referrer' );
	wp_redirect( $hit[1], 302, 'PH Agent Endpoint' ); // phpcs:ignore WordPress.Security.SafeRedirect -- fixed constants, never request input.
	exit;
}, 0 );

/* ------------------------------------------------------------------ /llms-full.txt and /.well-known/mcp.json */
/* llms.txt plus the full markdown twin of every allow-listed page and every industry page, each under its URL; and the MCP server card.
   Both are cached like the twins: a transient for 5 minutes (new generation when content changes) plus max-age=300. */

function llms_full_body() {
	$key  = 'ph_ae_full_' . md5( (string) tools_generation() );
	$body = get_transient( $key );
	if ( is_string( $body ) && '' !== $body ) {
		return $body;
	}
	$base = function_exists( IND_NS . 'data' ) ? (string) call_user_func( IND_NS . 'data', 'llms.php' ) : "# Personalisation Hub\n";
	$llms = (string) apply_filters( 'ph_llms_txt', $base );
	$docs = array();
	foreach ( array_keys( allow_list() ) as $id ) {
		$post = exposable_post( $id );
		if ( $post ) {
			$docs[] = array( page_url( $id ), twin_for( $post ) );
		}
	}
	if ( industry_hub_live() ) {
		$docs[] = array( home_url( '/industries/' ), industry_md_for( 'industries' ) );
	}
	foreach ( live_industries() as $r ) {
		$docs[] = array( $r[2], industry_md_for( $r[0] ) );
	}
	$body = llms_full_text( $llms, $docs );
	set_transient( $key, $body, 300 );
	return $body;
}

add_action( 'template_redirect', function () {
	$uri  = isset( $_SERVER['REQUEST_URI'] ) ? wp_unslash( $_SERVER['REQUEST_URI'] ) : ''; // phpcs:ignore WordPress.Security
	$path = (string) wp_parse_url( $uri, PHP_URL_PATH );
	if ( '/llms-full.txt' === $path ) {
		status_header( 200 );
		header( 'Content-Type: text/plain; charset=utf-8' );
		header( 'Cache-Control: public, max-age=300' );
		header( 'X-Content-Type-Options: nosniff' );
		echo llms_full_body(); // phpcs:ignore WordPress.Security.EscapeOutput -- plain text.
		exit;
	}
	if ( '/.well-known/mcp.json' === $path ) {
		status_header( 200 );
		header( 'Content-Type: application/json; charset=utf-8' );
		header( 'Cache-Control: public, max-age=300' );
		header( 'Access-Control-Allow-Origin: *' );
		header( 'X-Content-Type-Options: nosniff' );
		echo wp_json_encode( server_card(), JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT ); // phpcs:ignore WordPress.Security.EscapeOutput -- JSON.
		exit;
	}
}, 0 );

/* ------------------------------------------------------------------ /help-api/* and /mcp (1.8.0) */
/* The help API and the remote MCP server on personalisationhub.com, forwarded server side by proxy.php.
   Runs at parse_request, before the main query, the canonical redirect or any template. */

function proxy_request_from_globals() {
	$headers = array();
	foreach ( $_SERVER as $k => $v ) { // phpcs:ignore WordPress.Security
		if ( 0 === strpos( $k, 'HTTP_' ) && is_string( $v ) ) {
			$headers[ strtolower( str_replace( '_', '-', substr( $k, 5 ) ) ) ] = $v;
		}
	}
	if ( isset( $_SERVER['CONTENT_TYPE'] ) ) {
		$headers['content-type'] = (string) $_SERVER['CONTENT_TYPE'];
	}
	$method = isset( $_SERVER['REQUEST_METHOD'] ) ? strtoupper( (string) $_SERVER['REQUEST_METHOD'] ) : 'GET';
	$body   = 'POST' === $method ? (string) file_get_contents( 'php://input', false, null, 0, PROXY_BODY_MAX + 1 ) : '';
	return array(
		'method'  => $method,
		'path'    => (string) wp_parse_url( isset( $_SERVER['REQUEST_URI'] ) ? (string) $_SERVER['REQUEST_URI'] : '/', PHP_URL_PATH ), // phpcs:ignore WordPress.Security
		'query'   => isset( $_SERVER['QUERY_STRING'] ) ? (string) $_SERVER['QUERY_STRING'] : '',
		'headers' => $headers,
		'body'    => $body,
	);
}

function proxy_io() {
	return array(
		'transport' => function ( $method, $url, $headers, $body, $timeout ) {
			$args = array( 'method' => $method, 'headers' => $headers, 'timeout' => $timeout, 'redirection' => 0, 'limit_response_size' => 2 * 1024 * 1024 );
			if ( null !== $body ) {
				$args['body'] = $body;
			}
			$r = wp_remote_request( $url, $args );
			if ( is_wp_error( $r ) ) {
				$m = strtolower( $r->get_error_message() );
				return array( 'error' => ( false !== strpos( $m, 'timed out' ) || false !== strpos( $m, 'curl error 28' ) || false !== strpos( $m, 'timeout' ) ) ? 'timeout' : 'unavailable' );
			}
			$h = wp_remote_retrieve_headers( $r );
			$h = is_object( $h ) && method_exists( $h, 'getAll' ) ? $h->getAll() : (array) $h;
			return array( 'status' => (int) wp_remote_retrieve_response_code( $r ), 'headers' => $h, 'body' => (string) wp_remote_retrieve_body( $r ) );
		},
		'rate'      => function ( $bucket, $max, $cost ) {
			$wait = 0;
			for ( $i = 0; $i < max( 1, (int) $cost ); $i++ ) {
				$wait = rate_hit( $bucket, $max );
			}
			return $wait;
		},
		'cache_get' => function ( $key ) {
			$v = get_transient( $key );
			return is_array( $v ) ? $v : null;
		},
		'cache_set' => function ( $key, $value, $ttl ) {
			set_transient( $key, $value, $ttl );
		},
	);
}

add_action( 'parse_request', function () {
	$path = (string) wp_parse_url( isset( $_SERVER['REQUEST_URI'] ) ? (string) $_SERVER['REQUEST_URI'] : '/', PHP_URL_PATH ); // phpcs:ignore WordPress.Security
	if ( ! proxy_route( $path ) ) {
		return;
	}
	$out = proxy_handle( proxy_request_from_globals(), proxy_io() );
	if ( ! $out ) {
		return;
	}
	status_header( $out['status'] );
	header_remove( 'Access-Control-Allow-Credentials' );
	foreach ( $out['headers'] as $k => $v ) {
		header( $k . ': ' . $v );
	}
	echo $out['body']; // phpcs:ignore WordPress.Security.EscapeOutput -- JSON or markdown from the help service, console addresses rewritten.
	exit;
}, 0 );
