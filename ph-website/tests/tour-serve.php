<?php
/** Child process for tour.test.php: runs the tour's template_redirect handler for one request (it exits) and prints what it sent. */
namespace AngieSnippets\PhIndustryEnhancements_10063 {
	function header( $h ) { $GLOBALS['hdr'][] = $h; }
	function status_header( $c ) { $GLOBALS['status'] = $c; }
	function data( $f ) { return require __DIR__ . '/../snippets/ph-industry-enhancements/' . $f; }
}
namespace {
define( 'ABSPATH', '/' );
define( 'HOUR_IN_SECONDS', 3600 );
$GLOBALS['hdr'] = array(); $GLOBALS['status'] = 0; $GLOBALS['cbs'] = array();
function add_action( $n, $cb, $p = 10 ) { $GLOBALS['cbs'][ $n ][] = array( $p, $cb ); }
function wp_unslash( $v ) { return $v; } function sanitize_text_field( $v ) { return $v; }
function wp_parse_url( $u, $c = -1 ) { return parse_url( $u, $c ); }
function wp_json_encode( $v ) { return json_encode( $v ); }
require dirname( __DIR__ ) . '/snippets/ph-industry-enhancements/tour.php';
$_SERVER['REQUEST_METHOD'] = $argv[2] ?? 'GET'; $_SERVER['REQUEST_URI'] = $argv[1];
list( $prio, $cb ) = $GLOBALS['cbs']['template_redirect'][0];
register_shutdown_function( function () { echo "\n@@" . json_encode( array( 'hdr' => $GLOBALS['hdr'], 'status' => $GLOBALS['status'] ) ); } );
$cb();
echo '@@{"fellThrough":true,"prio":' . $prio . '}';
}
