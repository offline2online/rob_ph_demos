<?php
/** Child process for tour.test.php: runs the tour's template_redirect handler for one request (it exits) and prints what it sent. */
namespace AngieSnippets\PhIndustryEnhancements_10063 {
	function header( $h ) { $GLOBALS['hdr'][] = $h; }
	function status_header( $c ) { $GLOBALS['status'] = $c; }
	function data( $f ) { return require __DIR__ . '/../snippets/ph-industry-enhancements/' . $f; }
	function error_log( $m ) { $GLOBALS['logs'][] = $m; }
}
namespace {
define( 'ABSPATH', '/' );
define( 'HOUR_IN_SECONDS', 3600 );
$GLOBALS['hdr'] = array(); $GLOBALS['status'] = 0; $GLOBALS['cbs'] = array();
function add_action( $n, $cb, $p = 10 ) { $GLOBALS['cbs'][ $n ][] = array( $p, $cb ); }
function wp_unslash( $v ) { return $v; } function sanitize_text_field( $v ) { return $v; }
function wp_parse_url( $u, $c = -1 ) { return parse_url( $u, $c ); }
function wp_json_encode( $v ) { return json_encode( $v ); }
/* TOUR_MODE: tour-telco.php absent (tour.php copied alone), wp_remote_get stubbed: ok | bad | 404 | cached | stale. */
$GLOBALS['logs'] = array(); $GLOBALS['http'] = 0; $GLOBALS['opts'] = array();
$mode = getenv( 'TOUR_MODE' );
$src  = dirname( __DIR__ ) . '/snippets/ph-industry-enhancements';
$real = (string) file_get_contents( $src . '/tour/telco.html' );
if ( $mode ) {
	$tmp = sys_get_temp_dir() . '/tour-serve-' . getmypid(); @mkdir( $tmp );
	copy( $src . '/tour.php', $tmp . '/tour.php' );
	function get_option( $k, $d = false ) { return $GLOBALS['opts'][ $k ] ?? $d; }
	function update_option( $k, $v, $a = null ) { $GLOBALS['opts'][ $k ] = $v; $GLOBALS['autoload'] = $a; }
	function is_wp_error( $r ) { return false; }
	function wp_remote_get( $u, $a = array() ) { $GLOBALS['http']++; $GLOBALS['url'] = $u; $GLOBALS['timeout'] = $a['timeout'] ?? null; global $mode, $real; return array( 'code' => '404' === $mode ? 404 : 200, 'body' => 'bad' === $mode ? 'wrong bytes' : $real ); }
	function wp_remote_retrieve_response_code( $r ) { return $r['code']; }
	function wp_remote_retrieve_body( $r ) { return $r['body']; }
	if ( 'cached' === $mode ) { $GLOBALS['opts']['ph_tour_telco_html'] = array( 'sha' => hash( 'sha256', $real ), 'html' => $real ); }
	if ( 'stale' === $mode ) { $GLOBALS['opts']['ph_tour_telco_html'] = array( 'sha' => 'old', 'html' => 'old html' ); }
	register_shutdown_function( function () use ( $tmp ) { echo "\n##" . json_encode( array( 'http' => $GLOBALS['http'], 'logs' => $GLOBALS['logs'], 'stored' => isset( $GLOBALS['opts']['ph_tour_telco_html']['sha'] ) ? $GLOBALS['opts']['ph_tour_telco_html']['sha'] : null, 'autoload' => $GLOBALS['autoload'] ?? null, 'url' => $GLOBALS['url'] ?? null, 'timeout' => $GLOBALS['timeout'] ?? null ) ); @unlink( $tmp . '/tour.php' ); @rmdir( $tmp ); } );
	require $tmp . '/tour.php';
} else {
	require $src . '/tour.php';
}
$_SERVER['REQUEST_METHOD'] = $argv[2] ?? 'GET'; $_SERVER['REQUEST_URI'] = $argv[1];
list( $prio, $cb ) = $GLOBALS['cbs']['template_redirect'][0];
register_shutdown_function( function () { echo "\n@@" . json_encode( array( 'hdr' => $GLOBALS['hdr'], 'status' => $GLOBALS['status'] ) ); } );
$cb();
echo '@@{"fellThrough":true,"prio":' . $prio . '}';
}
