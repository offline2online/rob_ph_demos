<?php
namespace AngieSnippets\PhIndustryEnhancements_10063;

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

/**
 * Home page "Industries" section (7 Nov 2026): one tile per live industry page, near the bottom of the home page above the footer.
 * Server-rendered (works without JavaScript) and appended to the front page content after Elementor's own output.
 * Tracking lives in home-industries.js (loaded site-wide): a tile click pushes `ph_industry_tile` to the dataLayer and remembers the
 * industry so a later calculator, tour or form lead can be attributed to it.
 */
function home_industry_tiles() {
	return [
		[ 'convenience', 'Fuel & Convenience', 'Fuel stops into baskets, plus supplier-funded media.', '#FE9226' ],
		[ 'hospitality', 'Pubs & Hospitality', 'Higher revenue per head, every session.', '#FE9226' ],
		[ 'telco', 'Telco Retail', 'More walk-ins and post-pay conversions.', '#169BC2' ],
		[ 'pharmacy', 'Pharmacy', 'Contextual campaigns and a seamless pharmacist handover.', '#60D838' ],
		[ 'retail-media', 'Retail Media', 'Every screen, sold as targeted, measurable media.', '#EF60A7' ],
		[ 'grocery', 'Grocery & Supermarkets', 'Bigger baskets and new retail media revenue.', '#60D838' ],
		[ 'fashion', 'Fashion & Department Stores', 'More browsers become buyers in store.', '#EF60A7' ],
		[ 'qsr', 'Quick Service Restaurants', 'Higher order value from every screen.', '#EF60A7' ],
		[ 'banking', 'Banking', 'More home loan applications from branches.', '#169BC2' ],
	];
}

function home_industries_html() {
	$tiles = apply_filters( 'ph_home_industry_tiles', home_industry_tiles() );
	$out   = '<section class="ph-home-ind" id="industries" aria-labelledby="ph-home-ind-h"><div class="ph-home-ind-in">';
	$out  .= '<p class="ph-home-ind-eyebrow">Industries</p>';
	$out  .= '<h2 id="ph-home-ind-h">Find your industry</h2>';
	$out  .= '<p class="ph-home-ind-lead">See how Personalisation Hub works for your kind of business.</p>';
	$out  .= '<ul class="ph-home-ind-grid">';
	foreach ( $tiles as $t ) {
		$out .= '<li><a class="ph-home-ind-tile" style="--ph-ind-a:' . esc_attr( $t[3] ) . '" href="' . esc_url( page_url( $t[0] ) ) . '" data-ph-industry="' . esc_attr( $t[0] ) . '">'
			. '<span class="ph-home-ind-name">' . esc_html( $t[1] ) . '</span>'
			. '<span class="ph-home-ind-sum">' . esc_html( $t[2] ) . '</span>'
			. '<span class="ph-home-ind-go" aria-hidden="true">Explore &rarr;</span></a></li>';
	}
	$out .= '</ul>';
	$out .= '<p class="ph-home-ind-all"><a href="' . esc_url( page_url( 'industries' ) ) . '" data-ph-industry="industries">See all industries</a></p>';
	$out .= '</div></section>';
	return $out;
}

add_filter( 'the_content', function ( $content ) {
	static $done = false;
	if ( $done || is_admin() || ! is_front_page() || ! in_the_loop() || ! is_main_query() ) {
		return $content;
	}
	if ( isset( $_GET['elementor-preview'] ) || isset( $_GET['preview_id'] ) ) { // phpcs:ignore WordPress.Security.NonceVerification
		return $content;
	}
	$done = true;
	return $content . home_industries_html();
}, 20 );

add_action( 'wp_enqueue_scripts', function () {
	$ver = PH_INDUSTRY_ENHANCEMENTS_ASSETS_VERSION_10063;
	wp_enqueue_script( 'ph-home-ind-10063', angie_cs_get_snippet_asset_url( __FILE__, 'home-industries.js' ), [], $ver, true );
	if ( is_front_page() ) {
		wp_enqueue_style( 'ph-home-ind-10063', angie_cs_get_snippet_asset_url( __FILE__, 'home-industries.css' ), [], $ver );
	}
} );
