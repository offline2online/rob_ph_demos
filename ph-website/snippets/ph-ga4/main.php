<?php
/**
 * PH GA4: industry audiences, key events and the GA4 client_id on every lead.
 *
 * The site has no Google Tag Manager. Site Kit prints the Google tag (GT-WPDXCSKF -> G-LBEF15GKVQ) at wp_head; PH Consent
 * prints the Consent Mode defaults at priority 1. This snippet adds, at priority 2 (so before Site Kit's `config`):
 *   gtag("set", {industry, content_type})          every event on the page, page_view included, carries both
 *   gtag("set", "user_properties", {industry_interest})   on /industries/<slug>/ only: the last industry viewed
 * and ga4.js (deferred) fires the key events: industry_page_engaged, product_tour_start, product_tour_complete,
 * demo_request (Calendly booked), private_offer_request (AWS private-offer link) and lead_created.
 *
 * Lead forms: the ph-site/v1 lead routes (industry-lead, tour-lead, telco-model) read the visitor's GA4 client_id and
 * session_id from the _ga / _ga_LBEF15GKVQ cookies (the tour posts from a same-origin iframe, so cookies are the one source
 * every form shares), store them on the ph_lead post (ph_lead_ga_client_id, ph_lead_ga_session_id) and add them to the
 * console leadIngest body (gaClientId, gaSessionId, leadSource). The console's scheduled ACE job sends opportunity stage
 * changes to GA4 by Measurement Protocol keyed on that client_id. No consent, no _ga cookie, no client_id: nothing is
 * invented. Never in the browser: names, emails, company_name, the Measurement Protocol secret.
 */

namespace AngieSnippets\PhGa4___ID__;

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

const VER          = '1.0.0';
const STREAM_SUFFIX = 'LBEF15GKVQ'; // G-LBEF15GKVQ: the session cookie is _ga_LBEF15GKVQ.
const LEAD_ROUTES  = array( '/ph-site/v1/industry-lead', '/ph-site/v1/tour-lead', '/ph-site/v1/telco-model' );
const INGEST_URL   = 'https://backlog-tracker-e4ed2.web.app/leadIngest/v1/submit';

/** Full pages only (same rule as PH Consent). */
function should_load() {
	if ( is_admin() || wp_doing_ajax() || is_feed() || ( defined( 'REST_REQUEST' ) && REST_REQUEST ) || isset( $_GET['format'] ) ) { // phpcs:ignore WordPress.Security.NonceVerification
		return false;
	}
	return ! preg_match( '#/(llms\.txt|wp-json)(/|$)#', isset( $_SERVER['REQUEST_URI'] ) ? (string) $_SERVER['REQUEST_URI'] : '' );
}

/** The industry slug for a path, or "". Pure, so it is unit-tested. */
function industry_of( $path ) {
	return preg_match( '#^/industries/([a-z0-9-]{2,40})(?:/|$)#', (string) $path, $m ) ? $m[1] : '';
}

/** industry page | blog | product tour | pricing | other. $ctx: path, is_post, is_blog_index. Pure. */
function content_type_of( $path, array $ctx = array() ) {
	$p = (string) $path;
	if ( preg_match( '#^/industries/[a-z0-9-]+/tour/?$#', $p ) ) {
		return 'product tour';
	}
	if ( '' !== industry_of( $p ) ) {
		return 'industry page';
	}
	if ( ! empty( $ctx['is_post'] ) || ! empty( $ctx['is_blog_index'] ) || preg_match( '#^/blog(/|$)#', $p ) ) {
		return 'blog';
	}
	if ( preg_match( '#(^|/)pricing(/|$)#', $p ) ) {
		return 'pricing';
	}
	return 'other';
}

function request_path() {
	$uri = isset( $_SERVER['REQUEST_URI'] ) ? (string) wp_unslash( $_SERVER['REQUEST_URI'] ) : '/';
	return (string) wp_parse_url( $uri, PHP_URL_PATH );
}

/** The head call: runs before Site Kit's gtag("config"), so the automatic page_view carries the parameters. */
function head_script( $industry, $content_type ) {
	$set = array( 'industry' => '' !== $industry ? $industry : 'none', 'content_type' => $content_type );
	$js  = 'window.dataLayer=window.dataLayer||[];window.gtag=window.gtag||function(){dataLayer.push(arguments)};'
		. 'gtag("set",' . wp_json_encode( $set ) . ');';
	if ( '' !== $industry ) {
		$js .= 'gtag("set","user_properties",' . wp_json_encode( array( 'industry_interest' => $industry ) ) . ');';
	}
	$js .= 'window.PH_GA4=' . wp_json_encode( array( 'industry' => $industry, 'contentType' => $content_type ) ) . ';';
	return '<script id="ph-ga4-set">' . $js . '</script>';
}

add_action( 'wp_head', function () {
	if ( ! should_load() ) {
		return;
	}
	$path = request_path();
	$ct   = content_type_of( $path, array( 'is_post' => is_singular( 'post' ), 'is_blog_index' => is_home() ) );
	echo head_script( industry_of( $path ), $ct ); // phpcs:ignore WordPress.Security.EscapeOutput
}, 2 );

add_action( 'wp_enqueue_scripts', function () {
	if ( should_load() ) {
		wp_enqueue_script( 'ph-ga4-__ID__', angie_cs_get_snippet_asset_url( __FILE__, 'ga4.js' ), array(), VER, array( 'in_footer' => true, 'strategy' => 'defer' ) );
	}
} );

/* ---------- client_id on leads ---------- */

/**
 * GA4 ids from the cookies. _ga = GA1.1.<random>.<timestamp> -> client_id "<random>.<timestamp>".
 * _ga_<stream> = GS1.1.<session_id>.<n>... or GS2.1.s<session_id>$o<n>... -> session_id. Pure.
 */
function ga_ids( array $cookies ) {
	$out = array( 'client_id' => '', 'session_id' => '' );
	$ga  = isset( $cookies['_ga'] ) ? (string) $cookies['_ga'] : '';
	if ( preg_match( '/^GA\d\.\d+\.(\d{1,20}\.\d{9,11})$/', $ga, $m ) ) {
		$out['client_id'] = $m[1];
	}
	$gs = isset( $cookies[ '_ga_' . STREAM_SUFFIX ] ) ? (string) $cookies[ '_ga_' . STREAM_SUFFIX ] : '';
	if ( preg_match( '/^GS1\.\d+\.(\d{9,11})\./', $gs, $m ) || preg_match( '/^GS2\.\d+\.s(\d{9,11})\b/', $gs, $m ) ) {
		$out['session_id'] = $m[1];
	}
	return $out;
}

/** Source label for GA4's lead_source, from the ph_lead_captured payload. Pure. */
function lead_source_of( array $lead ) {
	$s = isset( $lead['source'] ) && is_scalar( $lead['source'] ) ? (string) $lead['source'] : '';
	return '' !== $s ? substr( sanitize_key( $s ), 0, 60 ) : 'website';
}

/** Ids for the lead request being handled (set only on the three lead routes). */
function current_ids( $set = null ) {
	static $ids = null;
	if ( null !== $set ) {
		$ids = $set;
	}
	return $ids;
}

add_filter( 'rest_request_before_callbacks', function ( $response, $handler, $request ) {
	if ( $request instanceof \WP_REST_Request && in_array( $request->get_route(), LEAD_ROUTES, true ) ) {
		current_ids( ga_ids( $_COOKIE ) ); // phpcs:ignore WordPress.Security.ValidatedSanitizedInput -- regex-validated in ga_ids().
	}
	return $response;
}, 10, 3 );

/** Before leads.php forwards it (priority 20): keep the ids on the ph_lead. */
add_action( 'ph_lead_captured', function ( $lead ) {
	$ids = current_ids();
	if ( ! is_array( $lead ) || ! $ids || empty( $lead['post_id'] ) ) {
		return;
	}
	if ( '' !== $ids['client_id'] ) {
		update_post_meta( (int) $lead['post_id'], 'ph_lead_ga_client_id', $ids['client_id'] );
	}
	if ( '' !== $ids['session_id'] ) {
		update_post_meta( (int) $lead['post_id'], 'ph_lead_ga_session_id', $ids['session_id'] );
	}
	update_post_meta( (int) $lead['post_id'], 'ph_lead_ga_source', lead_source_of( $lead ) );
	current_ids( array_merge( $ids, array( 'lead_source' => lead_source_of( $lead ) ) ) );
}, 5 );

/** Adds gaClientId / gaSessionId / leadSource to the console ingest body leads.php sends. Pure on its inputs. */
function add_ids_to_body( $body, array $ids ) {
	$j = json_decode( (string) $body, true );
	if ( ! is_array( $j ) ) {
		return $body;
	}
	if ( ! empty( $ids['client_id'] ) ) {
		$j['gaClientId'] = $ids['client_id'];
	}
	if ( ! empty( $ids['session_id'] ) ) {
		$j['gaSessionId'] = $ids['session_id'];
	}
	if ( ! empty( $ids['lead_source'] ) ) {
		$j['leadSource'] = $ids['lead_source'];
	}
	return wp_json_encode( $j );
}

add_filter( 'http_request_args', function ( $args, $url ) {
	$ids = current_ids();
	if ( INGEST_URL !== $url || ! $ids || empty( $args['body'] ) || ! is_string( $args['body'] ) ) {
		return $args;
	}
	$args['body'] = add_ids_to_body( $args['body'], $ids );
	return $args;
}, 10, 2 );
