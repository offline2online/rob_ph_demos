<?php
/**
 * PH Blog Layout: every blog post renders through the Theme Builder template
 * "PH Blog · Single post" (10142), never through Elementor Full Width.
 *
 * A post that has been saved through Elementor counts as "built with Elementor", and Elementor then
 * applies the kit's default page layout (Elementor Full Width). That layout prints only the post
 * content and skips the Theme Builder single template: no title, byline, hero or article menu.
 * All 25 posts were re-saved that way on 3 Nov 2026 and every article lost its layout.
 *
 * Blog posts are written in the block editor; their Elementor data is never what we show. So on the
 * public front end a post is never treated as built with Elementor. wp-admin, the Elementor editor
 * and its preview, AJAX and REST still see the real value.
 */

namespace AngieSnippets\PhBlogLayout_10644;

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

const VER = '1.0.0';

add_filter( 'get_post_metadata', function ( $value, $object_id, $meta_key, $single ) {
	if ( '_elementor_edit_mode' !== $meta_key ) {
		return $value;
	}
	if ( is_admin() || wp_doing_ajax() || ( defined( 'REST_REQUEST' ) && REST_REQUEST ) || isset( $_GET['elementor-preview'] ) ) { // phpcs:ignore WordPress.Security.NonceVerification
		return $value;
	}
	if ( 'post' !== get_post_type( $object_id ) ) {
		return $value;
	}
	return $single ? '' : [];
}, 10, 4 );
