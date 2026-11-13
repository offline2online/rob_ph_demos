<?php
/**
 * php ph-website/tests/operator-render.php : prints the [ph_operator] page body (operator_html()) for the Chromium fixture.
 * With the argument `head`, prints JSON instead: the document title, the header menu item and the SEO head (description, canonical,
 * Open Graph, Twitter card, JSON-LD) exactly as operator.php produces them on the page itself (hidden), so the fixture's <head> and
 * menu are the real ones.
 */
namespace {
define( 'ABSPATH', '/' );
define( 'PH_OPERATOR_TEST', 1 );
function esc_attr( $v ) { return htmlspecialchars( (string) $v, ENT_QUOTES ); }
function esc_html( $v ) { return htmlspecialchars( (string) $v, ENT_QUOTES ); }
function get_option( $k, $d = false ) { return 'ph_operator_page' === $k ? 10776 : $d; }
function apply_filters( $n, $v ) { return $v; }
function home_url( $p = '' ) { return 'http://x.test' . $p; }
class WP_Post { public $ID = 10776; public $post_name = 'run-your-own-rmn'; public $post_parent = 0; }
function is_page() { return true; }
function get_queried_object() { return new WP_Post(); }
require dirname( __DIR__ ) . '/snippets/ph-industry-enhancements/operator.php';
if ( isset( $argv[1] ) && 'head' === $argv[1] ) {
	$item = \AngieSnippets\PhIndustryEnhancements_10063\operator_menu_item( true, 3 );
	echo json_encode( array(
		'title' => \AngieSnippets\PhIndustryEnhancements_10063\operator_document_title( 'Untitled - Personalisation Hub' ),
		'menu'  => array( 'title' => $item->title, 'url' => $item->url, 'classes' => implode( ' ', $item->classes ), 'atts' => \AngieSnippets\PhIndustryEnhancements_10063\operator_menu_link_atts( array(), $item ) ),
		'seo'   => \AngieSnippets\PhIndustryEnhancements_10063\operator_head_html( \AngieSnippets\PhIndustryEnhancements_10063\operator_og_image(), false ),
	) );
} else {
	echo \AngieSnippets\PhIndustryEnhancements_10063\operator_html();
}
}
