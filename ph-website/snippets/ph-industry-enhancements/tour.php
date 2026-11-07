<?php
/**
 * Telco interactive product tour.
 *
 * - GET /industries/telco/tour/ (with or without the trailing slash): the tour page, served same-origin so the industry page can frame it
 *   (`?embed=1`). The HTML is tour-telco.php, generated from tour/telco.html by tools/build-tour.mjs. Answered at template_redirect
 *   priority 0 so redirect_canonical never sees it.
 * - POST ph-site/v1/tour-lead: the tour's gate form. Shaped like telco-model: honeypot, throttle, private ph_lead post, `ph_lead_captured`.
 *   No nonce: the page is edge-cached, so a stale wp_rest nonce would 403 anonymous callers (PH_TOUR.nonce is "").
 */
namespace AngieSnippets\PhIndustryEnhancements_10063;

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

const TOUR_PATH         = '/industries/telco/tour';
const TOUR_SOURCE       = 'interactive-product-tour';
const TOUR_SOURCE_LABEL = 'Interactive product tour – Telco';
const TOUR_FLOWS        = array( 'Campaign creation', 'Localisation & scheduling', 'Personalisation' );

/** Same list as FREE_MAIL in tour/telco.html. */
function tour_free_mail( $email ) {
	return (bool) preg_match( '/@(gmail|googlemail|outlook|hotmail|live|msn|yahoo|ymail|icloud|me|mac|aol|proton|protonmail|gmx|mail|zoho|yandex)\./i', (string) $email );
}

function tour_is_request( $path ) {
	return TOUR_PATH === rtrim( (string) $path, '/' );
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
	$page = '/industries/telco/';
	$id   = wp_insert_post( array( 'post_type' => 'ph_lead', 'post_status' => 'private', 'post_title' => $lead['company'] . ' / ' . $lead['name'] ) );
	if ( $id && ! is_wp_error( $id ) ) {
		foreach ( $lead as $k => $v ) {
			update_post_meta( $id, 'ph_lead_' . $k, $v );
		}
		update_post_meta( $id, 'ph_lead_source', TOUR_SOURCE );
		update_post_meta( $id, 'ph_lead_source_label', TOUR_SOURCE_LABEL );
		update_post_meta( $id, 'ph_lead_consent', 1 );
		update_post_meta( $id, 'ph_lead_tour_flow', $flow );
		update_post_meta( $id, 'ph_lead_page', $page );
		if ( $test ) {
			update_post_meta( $id, 'ph_lead_test', '1' );
		}
	}
	do_action( 'ph_lead_captured', array_merge( $lead, array( 'source' => TOUR_SOURCE, 'source_label' => TOUR_SOURCE_LABEL, 'source_detail' => $flow, 'consent' => true, 'industry' => 'telco', 'flow' => $flow, 'test' => $test, 'page' => $page, 'post_id' => (int) $id ) ) );
	if ( ! $test ) {
		wp_mail( get_option( 'admin_email' ), 'New Telco product tour lead: ' . $lead['company'], "Name: {$lead['name']}\nCompany: {$lead['company']}\nEmail: {$lead['email']}\nDemo: $flow\nPage: $page" );
	}
	return array( 200, array( 'ok' => true ) );
}

add_action( 'template_redirect', function () {
	$method = isset( $_SERVER['REQUEST_METHOD'] ) ? sanitize_text_field( wp_unslash( $_SERVER['REQUEST_METHOD'] ) ) : 'GET';
	$uri    = isset( $_SERVER['REQUEST_URI'] ) ? sanitize_text_field( wp_unslash( $_SERVER['REQUEST_URI'] ) ) : '';
	if ( 'GET' !== $method || ! tour_is_request( wp_parse_url( $uri, PHP_URL_PATH ) ) ) {
		return;
	}
	status_header( 200 );
	header( 'Content-Type: text/html; charset=utf-8' );
	header( 'X-Robots-Tag: noindex' );
	header( 'X-Frame-Options: SAMEORIGIN' );
	header( "Content-Security-Policy: frame-ancestors 'self'" );
	header( 'Cache-Control: public, max-age=3600' );
	echo data( 'tour-telco.php' ); // phpcs:ignore WordPress.Security.EscapeOutput -- a fixed, generated page.
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
