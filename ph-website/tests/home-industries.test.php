<?php
// Home page Industries section: one tile per live industry, each linking to its page, tracked by data-ph-industry.
namespace {
	define( 'ABSPATH', '/' );
	function esc_attr( $s ) { return htmlspecialchars( (string) $s, ENT_QUOTES ); }
	function esc_html( $s ) { return htmlspecialchars( (string) $s, ENT_QUOTES ); }
	function esc_url( $s ) { return (string) $s; }
	function home_url( $p = '' ) { return 'https://personalisationhub.com' . $p; }
	function apply_filters( $t, $v ) { return $v; }
	function add_filter() {}
	function add_action() {}
}
namespace AngieSnippets\PhIndustryEnhancements_10063 {
	const PH_INDUSTRY_ENHANCEMENTS_ASSETS_VERSION_10063 = 'x';
	const KEYS = [ 'industries', 'convenience', 'hospitality', 'telco', 'pharmacy', 'retail-media', 'grocery', 'fashion', 'qsr', 'banking' ];
	function page_url( $key ) { return 'industries' === $key ? home_url( '/industries/' ) : home_url( '/industries/' . $key . '/' ); }
	require __DIR__ . '/../snippets/ph-industry-enhancements/home-industries.php';
	$fail = 0;
	$ok   = function ( $c, $m ) use ( &$fail ) { echo ( $c ? 'ok   ' : 'FAIL ' ) . $m . "\n"; if ( ! $c ) { $fail++; } };
	$html = home_industries_html();
	foreach ( array_diff( KEYS, [ 'industries' ] ) as $k ) {
		$ok( false !== strpos( $html, 'href="https://personalisationhub.com/industries/' . $k . '/" data-ph-industry="' . $k . '"' ), "tile for $k" );
	}
	$ok( false !== strpos( $html, 'href="https://personalisationhub.com/industries/" data-ph-industry="industries"' ), 'see all industries link' );
	$ok( 9 === count( home_industry_tiles() ), 'nine tiles' );
	exit( $fail ? 1 : 0 );
}
