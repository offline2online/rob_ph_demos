<?php
namespace AngieSnippets\PhIndustryEnhancements_10063;

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

const PH_INDUSTRY_ENHANCEMENTS_ASSETS_VERSION_10063 = '1.9.25';
require_once __DIR__ . '/redirects.php';
require_once __DIR__ . '/telco-lead.php';
require_once __DIR__ . '/pharmacy-lead.php';
require_once __DIR__ . '/pubs-lead.php';
require_once __DIR__ . '/leads.php';
require_once __DIR__ . '/tour.php';
require_once __DIR__ . '/operator.php';
require_once __DIR__ . '/calculators-wp.php';
require_once __DIR__ . '/home-industries.php';
require_once __DIR__ . '/legacy-copy.php';
require_once __DIR__ . '/legacy-copy-v2.php';
require_once __DIR__ . '/legacy-copy-v3.php';
require_once __DIR__ . '/legacy-copy-v4.php';
require_once __DIR__ . '/legacy-logos.php';

const KEYS = [ 'industries', 'convenience', 'hospitality', 'telco', 'pharmacy', 'retail-media', 'grocery', 'fashion', 'qsr', 'banking' ];

function page_key() {
	if ( ! is_page() ) {
		return '';
	}
	$post = get_queried_object();
	if ( ! ( $post instanceof \WP_Post ) ) {
		return '';
	}
	if ( 'industries' === $post->post_name && 0 === (int) $post->post_parent ) {
		return 'industries';
	}
	if ( $post->post_parent && in_array( $post->post_name, KEYS, true ) ) {
		$parent = get_post( $post->post_parent );
		if ( $parent && 'industries' === $parent->post_name && 0 === (int) $parent->post_parent ) {
			return $post->post_name;
		}
	}
	return '';
}

function data( $file ) {
	static $cache = [];
	if ( ! isset( $cache[ $file ] ) ) {
		$cache[ $file ] = require __DIR__ . '/' . $file;
	}
	return $cache[ $file ];
}

function page_url( $key ) {
	return 'industries' === $key ? home_url( '/industries/' ) : home_url( '/industries/' . $key . '/' );
}

require_once __DIR__ . '/ai-hygiene.php';
require_once __DIR__ . '/ai-surface.php';

add_action( 'wp_enqueue_scripts', function () {
	wp_enqueue_style( 'ph-ind-footer-10063', angie_cs_get_snippet_asset_url( __FILE__, 'footer.css' ), [], PH_INDUSTRY_ENHANCEMENTS_ASSETS_VERSION_10063 );
	wp_enqueue_script( 'ph-ind-site-10063', angie_cs_get_snippet_asset_url( __FILE__, 'site.js' ), [], PH_INDUSTRY_ENHANCEMENTS_ASSETS_VERSION_10063, true );
	wp_enqueue_style( 'ph-ind-nav-10063', angie_cs_get_snippet_asset_url( __FILE__, 'nav.css' ), [], PH_INDUSTRY_ENHANCEMENTS_ASSETS_VERSION_10063 );
	$key = page_key();
	if ( '' === $key ) {
		return;
	}
	$ver = PH_INDUSTRY_ENHANCEMENTS_ASSETS_VERSION_10063;
	wp_enqueue_style( 'ph-ind-enhance-10063', angie_cs_get_snippet_asset_url( __FILE__, 'enhance.css' ), [], $ver );
	wp_enqueue_script( 'ph-ind-enhance-10063', angie_cs_get_snippet_asset_url( __FILE__, 'enhance.js' ), [], $ver, true );
	wp_add_inline_script( 'ph-ind-enhance-10063', 'window.PH_IND_PAGE = ' . wp_json_encode( $key ) . ';', 'before' );
} );

add_action( 'wp_head', function () {
	$key = page_key();
	if ( '' === $key ) {
		return;
	}
	$ld = data( 'ld.php' );
	if ( isset( $ld[ $key ] ) ) {
		echo '<script type="application/ld+json">' . $ld[ $key ] . '</script>' . "\n"; // phpcs:ignore WordPress.Security.EscapeOutput -- pre-encoded JSON with < escaped.
	}
	echo '<link rel="alternate" type="text/markdown" href="' . esc_url( add_query_arg( 'format', 'md', page_url( $key ) ) ) . '">' . "\n";
}, 20 );

add_action( 'template_redirect', function () {
	$uri  = isset( $_SERVER['REQUEST_URI'] ) ? sanitize_text_field( wp_unslash( $_SERVER['REQUEST_URI'] ) ) : '';
	$path = (string) wp_parse_url( $uri, PHP_URL_PATH );
	if ( '/llms.txt' === $path ) {
		status_header( 200 );
		header( 'Content-Type: text/plain; charset=utf-8' );
		echo apply_filters( 'ph_llms_txt', data( 'llms.php' ) ); // phpcs:ignore WordPress.Security.EscapeOutput -- plain-text file.
		exit;
	}
	if ( isset( $_GET['format'] ) && 'md' === sanitize_key( wp_unslash( $_GET['format'] ) ) ) {
		$key = page_key();
		$md  = '' !== $key ? industry_twin( $key ) : null;
		if ( null !== $md ) {
			status_header( 200 );
			header( 'Content-Type: text/markdown; charset=utf-8' );
			header( 'X-Robots-Tag: noindex' );
			echo $md; // phpcs:ignore WordPress.Security.EscapeOutput -- plain-text markdown.
			exit;
		}
	}
}, 0 );

/**
 * ElementsKit's icon font (ekiticons.css -> elementskit.woff, 455 KB) only drew the header burger and submenu chevron,
 * which nav.css now draws as SVG. Drop the stylesheet everywhere on the front end, but keep it in the Elementor editor and preview.
 * Elementor enqueues the handle while rendering the Icon widget and the ElementsKit nav, after wp_enqueue_scripts has run,
 * so it is dropped again at print time (footer scripts, priority 1) and, as a last resort, filtered out of the printed tag.
 */
function drop_ekiticons_here() {
	if ( is_admin() || is_customize_preview() ) {
		return false;
	}
	if ( isset( $_GET['elementor-preview'] ) || isset( $_GET['preview_id'] ) || isset( $_GET['elementor_library'] ) ) { // phpcs:ignore WordPress.Security.NonceVerification
		return false;
	}
	if ( class_exists( '\\Elementor\\Plugin' ) && isset( \Elementor\Plugin::$instance->preview ) && \Elementor\Plugin::$instance->preview->is_preview_mode() ) {
		return false;
	}
	return true;
}

function drop_ekiticons() {
	if ( ! drop_ekiticons_here() ) {
		return;
	}
	$styles = wp_styles();
	foreach ( $styles->registered as $handle => $style ) {
		if ( is_string( $style->src ) && false !== strpos( $style->src, 'ekiticons.css' ) ) {
			wp_dequeue_style( $handle );
			wp_deregister_style( $handle );
		}
	}
	foreach ( $styles->registered as $style ) {
		if ( ! empty( $style->deps ) ) {
			$style->deps = array_values( array_filter( $style->deps, function ( $dep ) use ( $styles ) {
				return isset( $styles->registered[ $dep ] );
			} ) );
		}
	}
}

add_action( 'wp_enqueue_scripts', __NAMESPACE__ . '\\drop_ekiticons', 9999 );
add_action( 'elementor/frontend/after_enqueue_styles', __NAMESPACE__ . '\\drop_ekiticons', 9999 );
add_action( 'wp_print_footer_scripts', __NAMESPACE__ . '\\drop_ekiticons', 1 );

add_filter( 'style_loader_tag', function ( $tag, $handle, $href ) {
	if ( is_string( $href ) && false !== strpos( $href, 'ekiticons.css' ) && drop_ekiticons_here() ) {
		return '';
	}
	return $tag;
}, 10, 3 );

/** Home hero background (Elementor container 155fba3): found early so it loads with the HTML, not after the CSS. */
function hero_bg_url() {
	$fallback = 'https://personalisationhub.com/wp-content/uploads/2026/11/home-hero-bg.webp';
	$id       = (int) get_option( 'page_on_front' );
	if ( $id ) {
		$data = get_post_meta( $id, '_elementor_data', true );
		$tree = is_string( $data ) ? json_decode( $data, true ) : $data;
		$url  = is_array( $tree ) ? find_bg( $tree ) : '';
		if ( '' !== $url ) {
			return $url;
		}
	}
	return $fallback;
}

function find_bg( array $nodes ) {
	foreach ( $nodes as $node ) {
		if ( ! is_array( $node ) ) {
			continue;
		}
		if ( isset( $node['id'] ) && '155fba3' === $node['id'] ) {
			$url = isset( $node['settings']['background_image']['url'] ) ? $node['settings']['background_image']['url'] : '';
			return is_string( $url ) ? $url : '';
		}
		if ( ! empty( $node['elements'] ) && is_array( $node['elements'] ) ) {
			$url = find_bg( $node['elements'] );
			if ( '' !== $url ) {
				return $url;
			}
		}
	}
	return '';
}

add_action( 'wp_head', function () {
	if ( ! is_front_page() ) {
		return;
	}
	echo '<link rel="preload" as="image" href="' . esc_url( hero_bg_url() ) . '" fetchpriority="high">' . "\n";
}, 1 );
