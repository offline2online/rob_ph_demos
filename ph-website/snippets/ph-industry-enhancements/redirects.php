<?php
namespace AngieSnippets\PhIndustryEnhancements_10063;

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

/**
 * Permanent 301s for pages whose slug moved. WordPress keeps no old-slug redirect
 * for pages and the site has no redirect plugin. To add a move, add one line:
 * lower-case old path (no trailing slash) => new path.
 */
function redirect_map() {
	return [
		'/retail-media-platform' => '/white-label-retail-media-platform/',
	];
}

/**
 * New path for a request URI, or '' when it is not a moved page. Matches the exact
 * old path only (case-insensitive, with or without the trailing slash); the query
 * string is carried over. GET and HEAD only.
 */
function redirect_target( $request_uri, $method = 'GET' ) {
	if ( ! in_array( strtoupper( (string) $method ), [ 'GET', 'HEAD' ], true ) ) {
		return '';
	}
	$parts = explode( '?', (string) $request_uri, 2 );
	$path  = strtolower( rtrim( (string) parse_url( $parts[0], PHP_URL_PATH ), '/' ) );
	$map   = redirect_map();
	if ( '' === $path || ! isset( $map[ $path ] ) ) {
		return '';
	}
	return $map[ $path ] . ( isset( $parts[1] ) && '' !== $parts[1] ? '?' . $parts[1] : '' );
}

add_action( 'template_redirect', function () {
	if ( is_admin() || wp_doing_ajax() || wp_doing_cron() || ( defined( 'REST_REQUEST' ) && REST_REQUEST )
		|| ( defined( 'WP_CLI' ) && WP_CLI ) || isset( $_GET['elementor-preview'] ) || isset( $_GET['elementor_preview_token'] ) ) { // phpcs:ignore WordPress.Security.NonceVerification
		return;
	}
	$to = redirect_target( isset( $_SERVER['REQUEST_URI'] ) ? wp_unslash( $_SERVER['REQUEST_URI'] ) : '', isset( $_SERVER['REQUEST_METHOD'] ) ? $_SERVER['REQUEST_METHOD'] : 'GET' ); // phpcs:ignore WordPress.Security.ValidatedSanitizedInput
	if ( '' !== $to ) {
		wp_redirect( home_url( $to ), 301 ); // phpcs:ignore WordPress.Security.SafeRedirect -- fixed internal map.
		exit;
	}
}, 0 );
