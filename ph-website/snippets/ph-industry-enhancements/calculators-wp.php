<?php
/**
 * WordPress glue for the business model calculators (list: calculators.php). Three outputs, all generated from that list:
 * the schema.org WebApplication JSON-LD and the on-page WebMCP tool on an industry's page, and the llms.txt section.
 * The MCP / WebMCP tool `calculate_business_model` is in the PH Agent Endpoint snippet and reads the same list.
 */
namespace AngieSnippets\PhIndustryEnhancements_10063;

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

require_once __DIR__ . '/calculators.php';

const PH_CALC_ASSETS_VERSION = '1.9.0';

add_action( 'wp_head', function () {
	$ld = calc_jsonld( page_key() );
	if ( '' !== $ld ) {
		echo '<script type="application/ld+json">' . $ld . '</script>' . "\n"; // phpcs:ignore WordPress.Security.EscapeOutput -- encoded with JSON_HEX_TAG.
	}
}, 21 );

add_action( 'wp_enqueue_scripts', function () {
	$cfg = calc_page_config( page_key() );
	if ( null === $cfg ) {
		return;
	}
	wp_enqueue_script( 'ph-ind-calc-webmcp-10063', angie_cs_get_snippet_asset_url( __FILE__, 'calc-webmcp.js' ), array( 'ph-ind-enhance-10063' ), PH_CALC_ASSETS_VERSION, true );
	wp_add_inline_script( 'ph-ind-calc-webmcp-10063', 'window.PH_CALCULATOR = ' . wp_json_encode_safe( $cfg ) . ';', 'before' );
} );

add_filter( 'ph_llms_txt', function ( $text ) {
	return calc_llms_filter( $text );
}, 25 );
