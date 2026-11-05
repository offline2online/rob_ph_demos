<?php
/** Offline tests for the PH Consent snippet: php ph-website/tests/ph-consent.test.php */
namespace {
error_reporting( E_ALL );
define( 'ABSPATH', '/' );
$fails = 0; $n = 0;
function ok( $c, $m ) { global $fails, $n; $n++; if ( ! $c ) { $fails++; fwrite( STDERR, "FAIL: $m\n" ); } }
function wp_unslash( $v ) { return $v; }
function do_action() { $GLOBALS['fired'][] = func_get_args(); }
function wp_json_encode( $v ) { return json_encode( $v ); }
function esc_html( $s ) { return htmlspecialchars( (string) $s ); }
function esc_url( $s ) { return (string) $s; }
$dir = dirname( __DIR__ ) . '/snippets/ph-consent';
$cfg = require $dir . '/config.php';
require $dir . '/helpers.php';

ok( strlen( $cfg['policy'] ) > 0 && 12 === $cfg['months'] && 24 === $cfg['purge'], 'policy version, 12 month choice, 24 month purge' );
foreach ( array( 'DE', 'FR', 'IE', 'GB', 'CH', 'NO', 'IS', 'LI' ) as $c ) { ok( in_array( $c, $cfg['eu'], true ), "$c is a default-denied region" ); }
ok( count( $cfg['eu'] ) === 32, '27 EU + IS LI NO + GB + CH' );
foreach ( array( 'AU', 'US', 'NZ' ) as $c ) { ok( ! in_array( $c, $cfg['eu'], true ), "$c is not EU" ); }
ok( array_keys( $cfg['categories'] ) === array( 'necessary', 'analytics', 'marketing' ), 'three categories' );
foreach ( $cfg['cookies'] as $k ) {
	ok( isset( $cfg['categories'][ $k['category'] ], $cfg['vendors'][ $k['vendor'] ] ) && $k['name'] && $k['purpose'] && $k['duration'], 'cookie row complete: ' . $k['name'] );
}

/* parse */
$p = $cfg['policy'];
$id = str_repeat( 'ab', 8 );
$c = ph_consent_parse( "v=$p&id=$id&a=1&m=0&d=0", $p );
ok( $c && $c['analytics'] && ! $c['marketing'] && ! $c['implied'], 'parse analytics only' );
ok( null === ph_consent_parse( "v=old&id=$id&a=1&m=1", $p ), 'older policy version asks again' );
ok( null === ph_consent_parse( "v=$p&id=zz&a=1&m=1", $p ), 'bad id rejected' );
ok( null === ph_consent_parse( '', $p ) && null === ph_consent_parse( null, $p ) && null === ph_consent_parse( str_repeat( 'a', 300 ), $p ), 'empty, null, oversized rejected' );

/* gate */
$_COOKIE = array();
ok( ph_consent_has( 'necessary' ), 'necessary always' );
ok( ! ph_consent_has( 'marketing' ) && ! ph_consent_has( 'analytics' ), 'no cookie = no consent' );
$_COOKIE['ph_consent'] = "v=$p&id=$id&a=1&m=0&d=0";
ok( ph_consent_has( 'analytics' ) && ! ph_consent_has( 'marketing' ), 'cookie grants analytics only' );
$GLOBALS['fired'] = array();
ok( false === ph_consent_server_event( 'linkedin', 'lead', array() ) && ! $GLOBALS['fired'], 'server event blocked without marketing consent' );
$_COOKIE['ph_consent'] = "v=$p&id=$id&a=1&m=1&d=0";
ok( true === ph_consent_server_event( 'meta', 'lead', array( 'x' => 1 ) ) && 'ph_consent_server_event' === $GLOBALS['fired'][0][0] && 'meta' === $GLOBALS['fired'][0][1], 'server event fires the hook with marketing consent' );

/* main.php pieces: stub WordPress just enough to load it */
	function add_action() {} function add_filter() {} function rest_url( $p ) { return 'https://x.test/wp-json/' . $p; }
	function esc_url_raw( $u ) { return $u; } function is_admin() { return false; } function wp_doing_ajax() { return false; }
	function is_feed() { return false; } function wp_enqueue_script() {} function angie_cs_get_snippet_asset_url() { return ''; }
	$src = file_get_contents( dirname( __DIR__ ) . '/snippets/ph-consent/main.php' );
	$src = str_replace( array( '__ID__', '__DIR__' ), array( '1', "'" . dirname( __DIR__ ) . '/snippets/ph-consent' . "'" ), $src );
	file_put_contents( sys_get_temp_dir() . '/ph-consent-main.php', $src );
	require sys_get_temp_dir() . '/ph-consent-main.php';
	use function AngieSnippets\PhConsent_1\{head_script,clean_entry,policy_html,should_load};

	$h = head_script();
	ok( strpos( $h, 'ad_storage:"denied"' ) !== false && strpos( $h, 'analytics_storage:"denied"' ) !== false && strpos( $h, 'ad_user_data:"denied"' ) !== false && strpos( $h, 'ad_personalization:"denied"' ) !== false, 'defaults denied for the four signals' );
	ok( strpos( $h, 'region:["AT"' ) !== false && strpos( $h, '"GB"' ) !== false && strpos( $h, '"CH"' ) !== false, 'denied via region list' );
	ok( strpos( $h, 'ads_data_redaction' ) !== false, 'ads_data_redaction set' );
	ok( strpos( $h, 'region:' ) < strpos( $h, '"granted"' ), 'regional deny comes before the granted default' );
	ok( strpos( $h, 'async' ) === false && strlen( $h ) < 1800, 'inline default stays small' );

	$e = clean_entry( array( 'id' => $id, 'v' => $p, 'region' => 'de', 'a' => true, 'm' => false, 'action' => 'accept', 'ip' => '1.2.3.4' ) );
	ok( $e && 'DE' === $e['region'] && 1 === $e['analytics'] && 0 === $e['marketing'] && ! isset( $e['ip'] ) && ! array_diff( array_keys( $e ), array( 'consent_id', 'region', 'analytics', 'marketing', 'policy', 'action' ) ), 'log entry holds no IP or extras' );
	ok( null === clean_entry( array( 'id' => 'bad', 'v' => $p ) ) && null === clean_entry( array( 'id' => $id, 'v' => 'old' ) ) && null === clean_entry( 'x' ), 'bad log entries rejected' );
	ok( 'XX' === clean_entry( array( 'id' => $id, 'v' => $p, 'region' => '<script>' ) )['region'], 'bad region becomes XX' );

	$html = policy_html();
	foreach ( $cfg['cookies'] as $k ) { ok( strpos( $html, htmlspecialchars( $k['name'] ) ) !== false, 'policy lists ' . $k['name'] ); }
	foreach ( $cfg['vendors'] as $v ) { ok( strpos( $html, $v['name'] ) !== false, 'policy lists vendor ' . $v['name'] ); }
	ok( strpos( $html, 'href="#cookie-settings"' ) !== false, 'policy links back to Cookie settings' );
	$_GET = array( 'format' => 'md' ); $_SERVER['REQUEST_URI'] = '/x/';
	ok( ! should_load(), 'markdown twins load nothing' );
	$_GET = array(); $_SERVER['REQUEST_URI'] = '/llms.txt';
	ok( ! should_load(), 'llms.txt loads nothing' );
	$_SERVER['REQUEST_URI'] = '/';
	ok( should_load(), 'normal pages load it' );

	$css = filesize( dirname( __DIR__ ) . '/snippets/ph-consent/consent.css' ); $js = filesize( dirname( __DIR__ ) . '/snippets/ph-consent/consent.js' );
	ok( $css < 2048, "inline CSS under 2 KB ($css)" );
	ok( $js < 10240, "consent.js under 10 KB ($js)" );
	echo "ph-consent.test.php: $n checks, $fails failed\n";
	exit( $fails ? 1 : 0 );
}
