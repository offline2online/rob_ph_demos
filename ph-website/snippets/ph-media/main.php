<?php
/**
 * PH Media: new uploads become WebP, and Elementor thumbnail srcset URLs stop 404ing.
 *
 * 1. Uploads. While WordPress builds an attachment's sub-sizes (and the "-scaled" copy of a very large image),
 *    JPEG and PNG sources are written as WebP at quality 80, transparency kept. The switch is on only between
 *    the first step of wp_create_image_subsizes() (the big_image_size_threshold filter) and the end of
 *    wp_generate_attachment_metadata(), so anything else that saves an image with an explicit format (the PH Site
 *    Icon snippet's PNG-in-ICO favicon) is untouched. GIF and SVG are never converted. If the server's image
 *    editor cannot write WebP, nothing here does anything.
 * 2. Srcset. Elementor stores custom sizes as "elementor/thumbs/<name>-<hash>.png", relative to the uploads root,
 *    but WordPress builds the srcset URL under the attachment's own year/month folder (a 404). The candidate URL
 *    is rewritten to /uploads/elementor/thumbs/...; it is dropped only if the attachment metadata does not list
 *    that file (no filesystem calls).
 * 3. Admin-only, read-only REST: POST /wp-json/ph-site/v1/media/webp-status.
 */

namespace AngieSnippets\PhMedia;

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

const VER     = '1.0.0';
const QUALITY = 80;

function webp_supported() {
	static $ok = null;
	if ( null === $ok ) {
		$ok = (bool) wp_image_editor_supports( [ 'mime_type' => 'image/webp' ] );
	}
	return $ok;
}

/** True while an attachment's sub-sizes are being generated. */
function converting( $set = null ) {
	static $on = false;
	if ( null !== $set ) {
		$on = (bool) $set;
	}
	return $on;
}

/* On: the first thing wp_create_image_subsizes() runs, before the -scaled copy. Value passes through untouched. */
add_filter( 'big_image_size_threshold', function ( $threshold ) {
	if ( webp_supported() ) {
		converting( true );
	}
	return $threshold;
}, 1 );

/* Off: as soon as the metadata is built or saved. */
$ph_media_off = function ( $metadata ) {
	converting( false );
	return $metadata;
};
add_filter( 'wp_generate_attachment_metadata', $ph_media_off, 999 );
add_filter( 'wp_update_attachment_metadata', $ph_media_off, 999 );
add_action( 'shutdown', function () {
	converting( false );
} );

add_filter( 'image_editor_output_format', function ( $formats, $filename = '', $mime_type = '' ) {
	if ( ! converting() || ! webp_supported() ) {
		return $formats;
	}
	$formats = is_array( $formats ) ? $formats : [];
	if ( in_array( $mime_type, [ 'image/jpeg', 'image/png' ], true ) ) {
		$formats[ $mime_type ] = 'image/webp';
	}
	return $formats;
}, 10, 3 );

add_filter( 'wp_editor_set_quality', function ( $quality, $mime_type = '' ) {
	return 'image/webp' === $mime_type ? QUALITY : $quality;
}, 10, 2 );

/**
 * Elementor custom sizes: fix the folder in the srcset URL, drop it only if the metadata does not list the file.
 */
function fix_srcset( $sources, $size_array = [], $image_src = '', $image_meta = [], $attachment_id = 0 ) {
	if ( ! is_array( $sources ) ) {
		return $sources;
	}
	$listed = null;
	foreach ( $sources as $w => $src ) {
		if ( empty( $src['url'] ) || ! preg_match( '#/uploads/\d{4}/\d{2}/(elementor/thumbs/[^/?\#]+)$#', $src['url'], $m ) ) {
			continue;
		}
		if ( null === $listed ) {
			$listed = [];
			foreach ( (array) ( $image_meta['sizes'] ?? [] ) as $size ) {
				if ( ! empty( $size['file'] ) ) {
					$listed[ $size['file'] ] = true;
				}
			}
		}
		if ( empty( $listed[ $m[1] ] ) ) {
			unset( $sources[ $w ] );
			continue;
		}
		$sources[ $w ]['url'] = preg_replace( '#/uploads/\d{4}/\d{2}/elementor/thumbs/#', '/uploads/elementor/thumbs/', $src['url'] );
	}
	return $sources;
}
add_filter( 'wp_calculate_image_srcset', __NAMESPACE__ . '\\fix_srcset', 10, 5 );

function webp_status() {
	global $wpdb;
	$count = (int) $wpdb->get_var( "SELECT COUNT(*) FROM {$wpdb->postmeta} WHERE meta_key = '_wp_attachment_metadata' AND meta_value LIKE '%.webp%'" ); // phpcs:ignore WordPress.DB.DirectDatabaseQuery
	return [
		'version'              => VER,
		'webp_output_active'   => webp_supported(),
		'quality'              => QUALITY,
		'attachments_with_webp' => $count,
	];
}

add_action( 'rest_api_init', function () {
	register_rest_route( 'ph-site/v1', '/media/webp-status', [
		'methods'             => 'POST',
		'permission_callback' => function () {
			return current_user_can( 'manage_options' );
		},
		'callback'            => function () {
			return rest_ensure_response( webp_status() );
		},
	] );
} );
