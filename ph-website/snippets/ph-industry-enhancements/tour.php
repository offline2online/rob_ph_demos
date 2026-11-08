<?php
/**
 * Interactive product tour (telco and pharmacy: one shared page, the path picks the industry).
 *
 * - GET /industries/telco/tour/ and /industries/pharmacy/tour/ (with or without the trailing slash): the same tour page, served same-origin so the industry
 *   page can frame it (`?embed=1`). The HTML is tour-page.php (generated from tour/tour.html by tools/build-tour.mjs) when deployed; otherwise a sha256-pinned copy, see tour_page(). Answered at template_redirect
 *   priority 0 so redirect_canonical never sees it.
 * - POST ph-site/v1/tour-lead: the tour's gate form. Shaped like telco-model: honeypot, throttle, private ph_lead post, `ph_lead_captured`.
 *   No nonce: the page is edge-cached, so a stale wp_rest nonce would 403 anonymous callers (PH_TOUR.nonce is "").
 */
namespace AngieSnippets\PhIndustryEnhancements_10063;

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

const TOUR_SOURCE = 'interactive-product-tour';
const TOUR_FLOWS  = array( 'Campaign creation', 'Localisation & scheduling', 'Personalisation' );
/** Industries the tour serves: key = the `industry` the tour sends; path = where the page is served; page = the industry page the lead came from. */
const TOUR_INDUSTRIES = array(
	'telco'    => array( 'name' => 'Telco', 'path' => '/industries/telco/tour', 'page' => '/industries/telco/', 'label' => 'Interactive product tour – Telco' ),
	'pharmacy' => array( 'name' => 'Pharmacy', 'path' => '/industries/pharmacy/tour', 'page' => '/industries/pharmacy/', 'label' => 'Interactive product tour – Pharmacy' ),
);

/**
 * Pinned copy of the tour page, used when tour-page.php is not deployed (it is 200 KB, too big for the deploy MCP's inline file
 * writes). The URL follows main; the sha256 is the pin, so the content is guaranteed whatever the URL serves. To update the tour,
 * merge it, then change TOUR_PAGE_SHA256 to the new tour.html's sha256; a changed sha refetches by itself. GitHub's raw CDN can serve the
 * previous main for a few minutes after a merge: until the fetched copy matches, the last good cached copy is served.
 */
const TOUR_PAGE_OPTION  = 'ph_tour_page_html';
const TOUR_PAGE_BACKOFF = 'ph_tour_page_backoff';
const TOUR_PAGE_SHA256  = '65deb2a3ff2edf451196c5d9f98ed6b5625d3caaf53b8ab19ee29381ed0e654e';
const TOUR_PAGE_URL     = 'https://raw.githubusercontent.com/offline2online/rob_ph_demos/main/ph-website/snippets/ph-industry-enhancements/tour/tour.html';

/**
 * The tour page HTML. Returns array( html|null, reason ). Order: tour-page.php next to this file; the cached option when its sha
 * matches TOUR_PAGE_SHA256; then the pinned URL (accepted only on a 200 whose sha256 matches; only then stored). When the fetch
 * fails or does not match, a 5-minute back-off transient stops further fetches, and an older cached copy (intact against its own sha)
 * is served with 200 and the reason returned for logging. With nothing cached the html is null and the route answers 503.
 */
function tour_page() {
	if ( file_exists( __DIR__ . '/tour-page.php' ) ) {
		return array( data( 'tour-page.php' ), '' );
	}
	$cached = get_option( TOUR_PAGE_OPTION );
	$intact = is_array( $cached ) && isset( $cached['sha'], $cached['html'] ) && is_string( $cached['html'] ) && '' !== $cached['html'] && hash( 'sha256', $cached['html'] ) === $cached['sha'];
	if ( $intact && TOUR_PAGE_SHA256 === $cached['sha'] ) {
		return array( $cached['html'], '' );
	}
	$why = '';
	if ( false !== get_transient( TOUR_PAGE_BACKOFF ) ) {
		$why = 'fetch skipped, backing off after an earlier failure';
	} else {
		$res = wp_remote_get( TOUR_PAGE_URL, array( 'timeout' => 10 ) );
		if ( is_wp_error( $res ) ) {
			$why = 'fetch failed: ' . $res->get_error_message();
		} elseif ( 200 !== (int) wp_remote_retrieve_response_code( $res ) ) {
			$why = 'fetch answered ' . (int) wp_remote_retrieve_response_code( $res );
		} else {
			$body = (string) wp_remote_retrieve_body( $res );
			if ( hash( 'sha256', $body ) === TOUR_PAGE_SHA256 ) {
				update_option( TOUR_PAGE_OPTION, array( 'sha' => TOUR_PAGE_SHA256, 'html' => $body ), false );
				return array( $body, '' );
			}
			$why = 'fetched copy does not match TOUR_PAGE_SHA256';
		}
		set_transient( TOUR_PAGE_BACKOFF, 1, 5 * MINUTE_IN_SECONDS );
	}
	if ( $intact ) {
		return array( $cached['html'], $why . '; serving the cached copy' );
	}
	return array( null, $why );
}

/** Same list as FREE_MAIL in tour/tour.html. */
function tour_free_mail( $email ) {
	return (bool) preg_match( '/@(gmail|googlemail|outlook|hotmail|live|msn|yahoo|ymail|icloud|me|mac|aol|proton|protonmail|gmx|mail|zoho|yandex)\./i', (string) $email );
}

function tour_is_request( $path ) {
	$p = rtrim( (string) $path, '/' );
	foreach ( TOUR_INDUSTRIES as $i ) {
		if ( $i['path'] === $p ) {
			return true;
		}
	}
	return false;
}

function tour_throttled() {
	$ip  = isset( $_SERVER['REMOTE_ADDR'] ) ? sanitize_text_field( wp_unslash( $_SERVER['REMOTE_ADDR'] ) ) : '';
	$key = 'ph_tour_rl_' . md5( $ip );
	$n   = (int) get_transient( $key );
	if ( $n >= 10 ) {
		return true;
	}
	set_transient( $key, $n + 1, HOUR_IN_SECONDS );
	return false;
}

/** Validates and stores a tour lead. Returns array( status, body ). Pure of HTTP, so it is unit-tested. */
function tour_handle( array $b ) {
	if ( ! empty( $b['website'] ) ) { // honeypot: pretend success.
		return array( 200, array( 'ok' => true ) );
	}
	if ( tour_throttled() ) {
		return array( 429, array( 'error' => 'Too many requests. Try again later.' ) );
	}
	$key = isset( $b['industry'] ) && is_string( $b['industry'] ) ? $b['industry'] : '';
	if ( ! isset( TOUR_INDUSTRIES[ $key ] ) ) {
		return array( 400, array( 'error' => 'Unknown industry.', 'field' => 'industry' ) );
	}
	$ind   = TOUR_INDUSTRIES[ $key ];
	$label = $ind['label'];
	$lead = array();
	foreach ( array( 'name', 'company' ) as $k ) {
		$lead[ $k ] = isset( $b[ $k ] ) && is_string( $b[ $k ] ) ? trim( sanitize_text_field( $b[ $k ] ) ) : '';
		if ( '' === $lead[ $k ] || strlen( $lead[ $k ] ) > 120 ) {
			return array( 400, array( 'error' => 'Please complete every field.', 'field' => $k ) );
		}
	}
	$lead['email'] = isset( $b['email'] ) && is_string( $b['email'] ) ? sanitize_email( $b['email'] ) : '';
	if ( ! is_email( $lead['email'] ) ) {
		return array( 400, array( 'error' => 'Please enter a valid email address.', 'field' => 'email' ) );
	}
	if ( tour_free_mail( $lead['email'] ) ) {
		return array( 400, array( 'error' => 'Please use your work email.', 'field' => 'email' ) );
	}
	if ( empty( $b['consent'] ) ) {
		return array( 400, array( 'error' => 'Please tick the box to continue.', 'field' => 'consent' ) );
	}
	$flow = isset( $b['flow'] ) && is_string( $b['flow'] ) ? trim( sanitize_text_field( $b['flow'] ) ) : '';
	$flow = in_array( $flow, TOUR_FLOWS, true ) ? $flow : '';
	$test = lead_is_test( isset( $b['test'] ) ? $b['test'] : false );
	$page = $ind['page'];
	$id   = lead_find_existing( $lead['email'], $test );
	if ( $id ) { // already a lead (for instance from the calculator download): record the tour as activity, not a second lead.
		lead_add_activity( $id, $label, $flow );
	} else {
		$id = wp_insert_post( array( 'post_type' => 'ph_lead', 'post_status' => 'private', 'post_title' => $lead['company'] . ' / ' . $lead['name'] ) );
		if ( $id && ! is_wp_error( $id ) ) {
			foreach ( $lead as $k => $v ) {
				update_post_meta( $id, 'ph_lead_' . $k, $v );
			}
			update_post_meta( $id, 'ph_lead_source', TOUR_SOURCE );
			update_post_meta( $id, 'ph_lead_source_label', $label );
			update_post_meta( $id, 'ph_lead_consent', 1 );
			update_post_meta( $id, 'ph_lead_page', $page );
			if ( $test ) {
				update_post_meta( $id, 'ph_lead_test', '1' );
			}
			lead_add_activity( $id, $label, $flow );
		}
	}
	if ( $id && ! is_wp_error( $id ) ) {
		update_post_meta( $id, 'ph_lead_tour_flow', $flow );
	}
	do_action( 'ph_lead_captured', array_merge( $lead, array( 'source' => TOUR_SOURCE, 'source_label' => $label, 'source_detail' => $flow, 'consent' => true, 'industry' => $key, 'flow' => $flow, 'test' => $test, 'page' => $page, 'post_id' => (int) $id ) ) );
	if ( ! $test ) {
		wp_mail( get_option( 'admin_email' ), 'New ' . $ind['name'] . ' product tour lead: ' . $lead['company'], "Name: {$lead['name']}\nCompany: {$lead['company']}\nEmail: {$lead['email']}\nDemo: $flow\nPage: $page" );
	}
	return array( 200, array( 'ok' => true ) );
}

add_action( 'template_redirect', function () {
	$method = isset( $_SERVER['REQUEST_METHOD'] ) ? sanitize_text_field( wp_unslash( $_SERVER['REQUEST_METHOD'] ) ) : 'GET';
	$uri    = isset( $_SERVER['REQUEST_URI'] ) ? sanitize_text_field( wp_unslash( $_SERVER['REQUEST_URI'] ) ) : '';
	if ( 'GET' !== $method || ! tour_is_request( wp_parse_url( $uri, PHP_URL_PATH ) ) ) {
		return;
	}
	list( $html, $why ) = tour_page();
	if ( '' !== $why ) {
		error_log( 'ph tour: ' . $why );
	}
	if ( null === $html ) {
		status_header( 503 );
		header( 'Content-Type: text/html; charset=utf-8' );
		header( 'X-Robots-Tag: noindex' );
		header( 'Cache-Control: no-store' );
		header( 'Retry-After: 60' );
		echo '<!doctype html><meta charset="utf-8"><meta name="robots" content="noindex"><title>Product tour unavailable</title><p>The product tour is unavailable right now. Please try again shortly.</p>';
		exit;
	}
	status_header( 200 );
	header( 'Content-Type: text/html; charset=utf-8' );
	header( 'X-Robots-Tag: noindex' );
	header( 'X-Frame-Options: SAMEORIGIN' );
	header( "Content-Security-Policy: frame-ancestors 'self'" );
	header( 'Cache-Control: public, max-age=3600' );
	echo $html; // phpcs:ignore WordPress.Security.EscapeOutput -- a fixed page, sha256-pinned when fetched.
	exit;
}, 0 );

add_action( 'rest_api_init', function () {
	register_rest_route( 'ph-site/v1', '/tour-lead', array(
		'methods'             => 'POST',
		'permission_callback' => '__return_true',
		'callback'            => function ( \WP_REST_Request $req ) {
			$b = $req->get_json_params();
			list( $status, $out ) = tour_handle( is_array( $b ) ? $b : array() );
			return new \WP_REST_Response( $out, $status );
		},
	) );
} );
