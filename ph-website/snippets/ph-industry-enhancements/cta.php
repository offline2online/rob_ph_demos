<?php
/**
 * Floating CTA (15 Nov 2026): one call to action fixed in the bottom-right corner of every front-end page, replacing the header's
 * "Arrange a Demo" button (removed from header template 2330 by the deploy session). It adapts to what the page offers:
 * - "request": the Run Your Own RMN page (operator_page_id()), "Request further information", scrolls to #request-info;
 * - "tour": an industry page with a guided tour (telco, pharmacy, retail media, convenience and any later TOUR_INDUSTRIES entry that
 *   lives under /industries/), "Take the guided tour", scrolls to the tour band (.ph-ind-tour, id ph-tour) and focuses its gate or start;
 * - "demo": every other page, "Arrange a demo", opens the same demo pop-up the header button opened (window.PH_SITE_DEMO from site.js,
 *   else Elementor Pro popup CTA_POPUP_ID, else CTA_DEMO_URL in a new tab);
 * - "hidden": every Support Centre page (/support-centre and everything under /support-centre/: the hub, categories, articles, search
 *   and any later route, cta_is_support_centre()), so the CTA is neither printed nor enqueued there and no dataLayer event fires.
 * The variant is decided here (cta_variant()) and printed as window.PH_FLOATING_CTA; cta.js renders it and confirms it on load for blocks
 * that mount later (a tour band built by enhance.js, a missing #request-info). Filter `ph_floating_cta` ($cfg, $context) overrides the
 * label, target or action for a page or module, or hides the CTA (`hidden` => true), or shows it on a Support Centre page
 * (`hidden` => false; $context['support_centre'] says which); a filtered config is `locked` and cta.js keeps it.
 * Never in the Elementor editor or preview, wp-admin or the customizer. Writes nothing; no personal data.
 */
namespace AngieSnippets\PhIndustryEnhancements_10063;

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

/** The header's demo pop-up (Elementor Pro popup) and the link it falls back to (site.js's Calendly booking URL). */
const CTA_POPUP_ID = 2658;
const CTA_DEMO_URL = 'https://calendly.com/rob-offline2online/30min?hide_gdpr_banner=1&primary_color=179bc2';
/** Each variant's default label, action ('scroll' renders an <a>, 'demo' a <button>) and target (an in-page anchor, '' for the pop-up). */
const CTA_VARIANTS = array(
	'request' => array( 'label' => 'Request further information', 'action' => 'scroll', 'target' => '#request-info' ),
	'tour'    => array( 'label' => 'Take the guided tour', 'action' => 'scroll', 'target' => '#ph-tour' ),
	'demo'    => array( 'label' => 'Arrange a demo', 'action' => 'demo', 'target' => '' ),
);

/** 'hidden' on a Support Centre page, 'request' on the Run Your Own RMN page, 'tour' on a page with a guided tour, else 'demo'. Pure. */
function cta_variant( $is_operator, $has_tour, $is_support = false ) {
	if ( $is_support ) {
		return 'hidden';
	}
	if ( $is_operator ) {
		return 'request';
	}
	return $has_tour ? 'tour' : 'demo';
}

/**
 * True for a Support Centre URL: the path (query and fragment ignored, case-insensitive, percent-decoded) is /support-centre (or
 * /support-centre.md), or starts with /support-centre/ (the hub, categories, articles, search and any other route the PH Support Centre snippet 10156 renders, and the
 * page visitors see while it is not live). /support-centre-x/ and /blog/support-centre/ are not. Pure.
 */
function cta_is_support_centre( $uri ) {
	$path = parse_url( (string) $uri, PHP_URL_PATH );
	if ( ! is_string( $path ) ) {
		return false;
	}
	$path = strtolower( rawurldecode( $path ) );
	return 1 === preg_match( '#^/+support-centre(?:/|\.md$|$)#', $path );
}

/** This request's path and query, for cta_is_support_centre(). */
function cta_request_uri() {
	$uri = isset( $_SERVER['REQUEST_URI'] ) ? (string) $_SERVER['REQUEST_URI'] : ''; // phpcs:ignore WordPress.Security.ValidatedSanitizedInput
	return function_exists( 'wp_unslash' ) ? wp_unslash( $uri ) : $uri;
}

/** The industry page keys (page_key()) that carry a guided tour: TOUR_INDUSTRIES entries under /industries/. */
function cta_tour_keys() {
	$keys = array();
	if ( defined( __NAMESPACE__ . '\\TOUR_INDUSTRIES' ) ) {
		foreach ( TOUR_INDUSTRIES as $key => $t ) {
			if ( empty( $t['operator'] ) && 0 === strpos( (string) $t['page'], '/industries/' ) ) {
				$keys[] = $key;
			}
		}
	}
	return $keys;
}

/** Keeps a label short and plain, and a target an in-page anchor (#id); anything else falls back to the variant's default. */
function cta_clean( array $cfg, array $def ) {
	$label = trim( preg_replace( '/\s+/', ' ', cta_plain( isset( $cfg['label'] ) ? (string) $cfg['label'] : '' ) ) );
	if ( '' === $label || strlen( $label ) > 60 ) {
		$label = $def['label'];
	}
	$action = isset( $cfg['action'] ) && in_array( $cfg['action'], array( 'scroll', 'demo' ), true ) ? $cfg['action'] : $def['action'];
	$target = isset( $cfg['target'] ) ? (string) $cfg['target'] : $def['target'];
	if ( 'scroll' === $action && 1 !== preg_match( '/^#[A-Za-z][A-Za-z0-9_-]{0,63}$/', $target ) ) {
		$target = 'scroll' === $def['action'] ? $def['target'] : '';
		$action = '' === $target ? 'demo' : $action;
	}
	return array(
		'variant' => isset( $cfg['variant'] ) && 1 === preg_match( '/^[a-z][a-z0-9-]{0,31}$/', (string) $cfg['variant'] ) ? (string) $cfg['variant'] : $def['variant'],
		'label'   => $label,
		'action'  => $action,
		'target'  => 'demo' === $action ? '' : $target,
		'hidden'  => ! empty( $cfg['hidden'] ),
	);
}

/** Plain text without a WordPress dependency (tests run without WordPress). */
function cta_plain( $s ) {
	return function_exists( 'wp_strip_all_tags' ) ? wp_strip_all_tags( $s ) : trim( strip_tags( $s ) );
}

/**
 * The config cta.js renders: the variant's defaults (hidden on a Support Centre page), then filter `ph_floating_cta` ($cfg, $context),
 * cleaned. `locked` is true when the filter changed anything, so cta.js keeps a page's own choice instead of re-deciding. Pure apart
 * from the filter.
 */
function cta_config( $is_operator, $has_tour, $is_support = false ) {
	$variant = cta_variant( $is_operator, $has_tour, $is_support );
	$hidden  = 'hidden' === $variant;
	if ( $hidden ) { // a filter that shows the CTA on a Support Centre page gets the demo button
		$variant = 'demo';
	}
	$def     = array_merge( array( 'variant' => $variant ), CTA_VARIANTS[ $variant ] );
	$base    = array_merge( $def, array( 'hidden' => $hidden ) );
	$context = array( 'operator' => (bool) $is_operator, 'tour' => (bool) $has_tour, 'support_centre' => $hidden );
	$out     = function_exists( 'apply_filters' ) ? apply_filters( 'ph_floating_cta', $base, $context ) : $base;
	$cfg     = cta_clean( is_array( $out ) ? $out : $base, $def );
	return array_merge( $cfg, array(
		'locked' => $cfg !== cta_clean( $base, $def ),
		'popup'  => CTA_POPUP_ID,
		'href'   => CTA_DEMO_URL,
	) );
}

/** False in wp-admin, the customizer and the Elementor editor or preview: the CTA is a front-end element only. */
function cta_here() {
	if ( ( function_exists( 'is_admin' ) && is_admin() ) || ( function_exists( 'is_customize_preview' ) && is_customize_preview() ) ) {
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

/** This request's config: the Support Centre, the operator page and the tour pages are known server-side. */
function cta_page_config() {
	$is_support  = cta_is_support_centre( cta_request_uri() );
	$is_operator = ! $is_support && function_exists( __NAMESPACE__ . '\\operator_is_page' ) && operator_is_page();
	$has_tour    = ! $is_support && in_array( page_key(), cta_tour_keys(), true );
	return cta_config( $is_operator, $has_tour, $is_support );
}

function cta_enqueue() {
	if ( ! cta_here() ) {
		return;
	}
	$cfg = cta_page_config();
	if ( $cfg['hidden'] ) {
		return;
	}
	$ver = PH_INDUSTRY_ENHANCEMENTS_ASSETS_VERSION_10063;
	wp_enqueue_style( 'ph-cta-10063', angie_cs_get_snippet_asset_url( __FILE__, 'cta.css' ), array(), $ver );
	wp_enqueue_script( 'ph-cta-10063', angie_cs_get_snippet_asset_url( __FILE__, 'cta.js' ), array(), $ver, true );
	wp_add_inline_script( 'ph-cta-10063', 'window.PH_FLOATING_CTA = ' . wp_json_encode( $cfg ) . ';', 'before' );
}

if ( function_exists( 'add_action' ) && ! defined( 'PH_CTA_TEST' ) ) {
	add_action( 'wp_enqueue_scripts', __NAMESPACE__ . '\\cta_enqueue', 20 );
}
