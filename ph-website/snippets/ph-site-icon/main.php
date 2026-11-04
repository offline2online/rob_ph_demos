<?php
/**
 * PH Site Icon: makes /favicon.ico the Personalisation Hub icon.
 *
 * Every page already declares the WordPress Site Icon (the PH icon), but the web root still holds the hosting
 * provider's default favicon.ico (an Elementor logo). Browsers fall back to that file for anything without an
 * icon tag (text and markdown files, sitemaps, tabs that are still loading) and cache it. This snippet rebuilds
 * favicon.ico from the Site Icon (16, 32, 48 and 64 px, PNG-in-ICO), keeps one backup of the replaced file, and
 * rebuilds it again whenever the Site Icon changes. Admin-only REST: POST /wp-json/ph-site/v1/favicon.
 */

namespace AngieSnippets\PhSiteIcon_10157;

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

const VER   = '1.0.1';
const SIZES = [ 16, 32, 48, 64 ];

function build_ico( $att_id ) {
	$file = $att_id ? get_attached_file( $att_id ) : '';
	if ( ! $file || ! file_exists( $file ) ) {
		return new \WP_Error( 'ph_icon_source', 'The Site Icon image file was not found.' );
	}
	$pngs = [];
	foreach ( SIZES as $s ) {
		$ed = wp_get_image_editor( $file );
		if ( is_wp_error( $ed ) ) {
			return $ed;
		}
		$ed->resize( $s, $s, true );
		$tmp = wp_tempnam( 'ph-icon-' . $s . '.png' );
		$out = $ed->save( $tmp, 'image/png' );
		if ( is_wp_error( $out ) ) {
			return $out;
		}
		$pngs[ $s ] = (string) file_get_contents( $out['path'] ); // phpcs:ignore WordPress.WP.AlternativeFunctions
		wp_delete_file( $out['path'] );
		if ( $tmp !== $out['path'] ) {
			wp_delete_file( $tmp );
		}
	}
	$n      = count( $pngs );
	$head   = pack( 'vvv', 0, 1, $n );
	$dir    = '';
	$data   = '';
	$offset = 6 + 16 * $n;
	foreach ( $pngs as $s => $png ) {
		$dir    .= pack( 'CCCCvvVV', $s >= 256 ? 0 : $s, $s >= 256 ? 0 : $s, 0, 0, 1, 32, strlen( $png ), $offset );
		$data   .= $png;
		$offset += strlen( $png );
	}
	return $head . $dir . $data;
}

function write_favicon() {
	require_once ABSPATH . 'wp-admin/includes/file.php';
	$att = (int) get_option( 'site_icon' );
	$ico = build_ico( $att );
	if ( is_wp_error( $ico ) ) {
		return [ 'written' => false, 'error' => $ico->get_error_message() ];
	}
	if ( ! WP_Filesystem() ) {
		return [ 'written' => false, 'error' => 'The filesystem is not writable from WordPress.' ];
	}
	global $wp_filesystem;
	$path   = ABSPATH . 'favicon.ico';
	$backup = ABSPATH . 'favicon-hosting-default.ico';
	$old    = $wp_filesystem->exists( $path ) ? (string) $wp_filesystem->get_contents( $path ) : '';
	if ( $old === $ico ) {
		return [ 'written' => true, 'unchanged' => true, 'bytes' => strlen( $ico ), 'site_icon' => $att ];
	}
	if ( '' !== $old && ! $wp_filesystem->exists( $backup ) ) {
		$wp_filesystem->put_contents( $backup, $old, FS_CHMOD_FILE );
	}
	$ok = $wp_filesystem->put_contents( $path, $ico, FS_CHMOD_FILE );
	update_option( 'ph_site_icon_state', [ 'at' => time(), 'ok' => (bool) $ok, 'bytes' => strlen( $ico ), 'site_icon' => $att ], false );
	return [ 'written' => (bool) $ok, 'bytes' => strlen( $ico ), 'replaced_bytes' => strlen( $old ), 'backup' => $wp_filesystem->exists( $backup ) ? 'favicon-hosting-default.ico' : '', 'site_icon' => $att ];
}

add_action( 'rest_api_init', function () {
	register_rest_route( 'ph-site/v1', '/favicon', [
		'methods'             => 'POST',
		'permission_callback' => function () {
			return current_user_can( 'manage_options' );
		},
		'callback'            => function () {
			return rest_ensure_response( write_favicon() );
		},
	] );
} );

/* Keep favicon.ico in step with Settings > General > Site Icon. */
add_action( 'update_option_site_icon', function () {
	write_favicon();
} );
