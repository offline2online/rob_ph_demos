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
		'/franchise'             => '/be-your-own-boss/', // 13 Nov 2026: page 10776 renamed in place by franchise.php
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

/**
 * One-time slug moves, post ID => [ old slug, new slug ]. The WordPress MCP has no
 * slug tool, so publishing this snippet moves the slug itself on the first request.
 * Pair every line with a redirect_map() line for the old path.
 */
function slug_moves() {
	return [
		3266 => [ 'retail-media-platform', 'white-label-retail-media-platform' ],
	];
}

/**
 * The new slug to apply, or '' to do nothing. Moves only a published page that
 * still has the old slug and is not recorded as done; a page already on the new
 * slug, renamed by hand to something else, a draft or a missing post is left alone.
 */
function slug_move_decision( $post, $done, $id, $from, $to ) {
	if ( in_array( (int) $id, array_map( 'intval', (array) $done ), true ) || ! is_object( $post ) ) {
		return '';
	}
	if ( 'page' !== $post->post_type || 'publish' !== $post->post_status || $from !== $post->post_name ) {
		return '';
	}
	return $to;
}

function run_slug_moves() {
	if ( ( defined( 'WP_CLI' ) && WP_CLI ) || wp_doing_cron() ) {
		return;
	}
	$done = get_option( 'ph_slug_moves_done', [] );
	$done = is_array( $done ) ? $done : [];
	$dirty = false;
	foreach ( slug_moves() as $id => $names ) {
		if ( in_array( (int) $id, array_map( 'intval', $done ), true ) ) {
			continue;
		}
		$new = slug_move_decision( get_post( $id ), $done, $id, $names[0], $names[1] );
		if ( '' !== $new ) {
			$res = wp_update_post( [ 'ID' => $id, 'post_name' => $new ], true );
			if ( is_wp_error( $res ) || ! $res ) {
				continue; // try again on the next request
			}
		}
		$done[] = (int) $id; // moved, or nothing to move: do not look again.
		$dirty  = true;
	}
	if ( $dirty ) {
		update_option( 'ph_slug_moves_done', $done, false );
	}
}
add_action( 'init', __NAMESPACE__ . '\\run_slug_moves', 20 );
