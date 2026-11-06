<?php
/** Prints the real Consent Mode <head> script for ph-consent.test.mjs. */
namespace {
	define( 'ABSPATH', '/' );
	function add_action() {} function add_filter() {} function rest_url( $p ) { return 'https://example.test/wp-json/' . $p; }
	function esc_url_raw( $u ) { return $u; } function wp_json_encode( $v ) { return json_encode( $v ); }
	$d   = dirname( __DIR__ ) . '/snippets/ph-consent';
	$src = str_replace( array( '__ID__', '__DIR__' ), array( '1', "'" . $d . "'" ), file_get_contents( $d . '/main.php' ) );
	file_put_contents( sys_get_temp_dir() . '/ph-consent-head-main.php', $src );
	require sys_get_temp_dir() . '/ph-consent-head-main.php';
	echo \AngieSnippets\PhConsent_1\head_script();
}
