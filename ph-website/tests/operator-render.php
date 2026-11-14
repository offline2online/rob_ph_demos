<?php
/**
 * php ph-website/tests/operator-render.php : prints the Run Your Own RMN page's <main> for the Chromium fixture, shaped like the Elementor
 * page built from ph-website/elementor/run-your-own-rmn.md: the Elementor sections as Elementor containers and widgets (headings, text,
 * buttons with the brief's anchors; the copy is the twin's lists, which the brief carries word for word) and the three Shortcode widgets
 * ([ph_operator_calculator], [ph_operator_faq], [ph_operator_tour]) wrapped exactly as Elementor wraps a Shortcode widget, in the
 * brief's order. With the argument `head`, prints JSON instead: the document title, the header menu item and the SEO head exactly as
 * operator.php produces them on the page itself (hidden), so the fixture's <head> and menu are the real ones.
 */
namespace {
define( 'ABSPATH', '/' );
define( 'OBJECT', 'OBJECT' );
define( 'PH_OPERATOR_TEST', 1 );
function esc_attr( $v ) { return htmlspecialchars( (string) $v, ENT_QUOTES ); }
function esc_html( $v ) { return htmlspecialchars( (string) $v, ENT_QUOTES ); }
function get_option( $k, $d = false ) { return 'ph_operator_page' === $k ? 10900 : $d; }
function update_option() { return true; }
function delete_option() { return true; }
function apply_filters( $n, $v ) { return $v; }
function home_url( $p = '' ) { return 'http://x.test' . $p; }
class WP_Post { public $ID = 10900; public $post_name = 'run-your-own-rmn'; public $post_parent = 0; public $post_type = 'page'; public $post_status = 'publish'; }
function get_post( $id ) { return 10900 === (int) $id ? new WP_Post() : null; }
function get_post_meta( $id, $k, $s = false ) { return ( 10900 === (int) $id && '_elementor_edit_mode' === $k ) ? 'builder' : ''; }
function is_page() { return true; }
function get_queried_object() { return new WP_Post(); }
require dirname( __DIR__ ) . '/snippets/ph-industry-enhancements/operator.php';
}

namespace AngieSnippets\PhIndustryEnhancements_10063 {
if ( isset( $argv[1] ) && 'head' === $argv[1] ) {
	$item = operator_menu_item( true, 3 );
	echo json_encode( array(
		'title' => operator_document_title( 'Untitled - Personalisation Hub' ),
		'menu'  => array( 'title' => $item->title, 'url' => $item->url, 'classes' => implode( ' ', $item->classes ), 'atts' => operator_menu_link_atts( array(), $item ) ),
		'seo'   => operator_head_html( operator_og_image(), false ),
	) );
	return;
}
$n   = 0;
$el  = function ( $type, $inner ) use ( &$n ) {
	$n++;
	return '<div class="elementor-element elementor-element-f' . $n . ' elementor-widget elementor-widget-' . $type . '" data-element_type="widget" data-widget_type="' . $type . '.default"><div class="elementor-widget-container">' . $inner . '</div></div>';
};
$con = function ( $id, $inner, $bg = '#FFFFFF', $color = '#181A1F' ) use ( &$n ) {
	$n++;
	return '<div class="elementor-element elementor-element-c' . $n . ' e-con-full e-flex e-con e-parent"' . ( $id ? ' id="' . $id . '"' : '' ) . ' data-element_type="container" style="background:' . $bg . ';color:' . $color . '"><div class="e-con-inner">' . $inner . '</div></div>';
};
$h = function ( $tag, $text ) use ( $el ) { return $el( 'heading', '<' . $tag . ' class="elementor-heading-title elementor-size-default">' . esc_html( $text ) . '</' . $tag . '>' ); };
$t = function ( $text ) use ( $el ) { return $el( 'text-editor', '<p>' . esc_html( $text ) . '</p>' ); };
$b = function ( $text, $href ) use ( $el ) { return $el( 'button', '<div class="elementor-button-wrapper"><a class="elementor-button elementor-button-link elementor-size-sm" href="' . $href . '"><span class="elementor-button-content-wrapper"><span class="elementor-button-text">' . esc_html( $text ) . '</span></span></a></div>' ); };
$sc = function ( $html ) use ( $el, $con ) { return $con( '', $el( 'shortcode', '<div class="elementor-shortcode">' . $html . '</div>' ), 'transparent' ); };

$why = '';
foreach ( operator_why_items() as $w ) { $why .= $h( 'p', $w[1] ) . $t( $w[2] ); }
$steps = '';
foreach ( operator_steps() as $s ) { $steps .= $h( 'p', $s[0] . ' ' . $s[1] ) . $t( $s[2] ); }
$out  = '<div data-elementor-type="wp-page" data-elementor-id="10900" class="elementor elementor-10900" data-elementor-post-type="page">';
$out .= $con( 'top', $h( 'h1', OPERATOR_H1 ) . $h( 'p', OPERATOR_SUBLINE ) . $t( OPERATOR_HERO_P ) . $b( 'See how much you can earn', '#calculator' ) . $b( 'Request further information', '#tour' ) . $h( 'p', 'Why it beats anything out there' ) . $why, '#F9FAFD' );
$out .= $con( 'why', $h( 'h2', 'Your head start in a changing industry' ) );
$out .= $con( 'who', $h( 'h2', 'Built for people who know media' ), '#F9FAFD' );
$out .= $con( 'how', $h( 'h2', 'How it works' ) . $steps );
$out .= $con( 'venues', $h( 'h2', 'Any business with a physical presence' ) . $t( implode( ' · ', OPERATOR_VENUE_TYPES ) ), '#181A1F', '#FFFFFF' );
$out .= $con( 'standards', $h( 'h2', "Built to fix retail media's fragmentation" ) );
$out .= $sc( operator_calculator_html() );
$out .= $con( 'independents', $h( 'h2', 'Give independents a fighting chance' ), '#F9FAFD' );
$out .= $sc( operator_faq_html() );
$out .= $sc( operator_tour_html() );
echo $out . '</div>';
}
