<?php
/**
 * PH Agent Endpoint (Angie snippet). Version 1.0.0
 *
 * Markdown twins (?format=md), one shared JSON-LD graph and llms.txt sections
 * for the allow-listed pages in lib.php. Industries, Blog and Support Centre
 * keep their own twins and graphs; they reference the shared nodes by @id.
 *
 * Performance (design guide s.7): inline JSON-LD only, no assets, no remote
 * calls; twins are cached in a transient (5 min) plus max-age=300.
 */
namespace PhAgentEndpoint;

if ( ! defined( 'ABSPATH' ) ) {
	return;
}
require_once __DIR__ . '/lib.php';

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

/* Markdown twin. */
add_action( 'template_redirect', function () {
	if ( ! isset( $_GET['format'] ) || $_GET['format'] !== 'md' ) {
		return;
	}
	$post = current_exposable();
	if ( ! $post ) {
		return; // not ours: other snippets may serve their own twin; otherwise normal page.
	}
	$key = 'ph_ae_md_' . $post->ID . '_' . md5( $post->post_modified_gmt );
	$md  = get_transient( $key );
	if ( ! is_string( $md ) || $md === '' ) {
		$html = class_exists( '\Elementor\Plugin' )
			? \Elementor\Plugin::$instance->frontend->get_builder_content_for_display( $post->ID )
			: '';
		if ( trim( (string) $html ) === '' ) {
			$html = apply_filters( 'the_content', $post->post_content );
		}
		$md = markdown_twin( page_title( $post ), page_summary( $post ), page_url( $post->ID ), $html );
		set_transient( $key, $md, 300 );
	}
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
